"""Opaque, revocable server sessions; no client role or identity is authoritative."""
import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, ConfigDict
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from . import config
from .db import connection

router = APIRouter(prefix="/api/auth")
hasher = PasswordHasher()
hash_slots = threading.BoundedSemaphore(2)


def hash_password(password):
    if not hash_slots.acquire(blocking=False):
        raise HTTPException(429, "Máy chủ đang bận, vui lòng thử lại.")
    try:
        return hasher.hash(password)
    finally:
        hash_slots.release()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def rate_limit(key, maximum, seconds=60):
    now = int(time.time())
    bucket = now // seconds
    with connection() as db:
        db.execute("DELETE FROM rate_limits WHERE expires < ?", (now,))
        db.execute("""INSERT INTO rate_limits(key, bucket, count, expires) VALUES (?, ?, 1, ?)
            ON CONFLICT(key, bucket) DO UPDATE SET count=count+1""", (key, bucket, (bucket+1)*seconds))
        count = db.execute("SELECT count FROM rate_limits WHERE key=? AND bucket=?", (key, bucket)).fetchone()[0]
    if count > maximum:
        raise HTTPException(429, "Quá nhiều yêu cầu. Vui lòng thử lại sau.", headers={"Retry-After": str(seconds)})


def public_user(row):
    return {k: row[v] for k, v in {"id": "id", "username": "username", "displayName": "display_name", "age": "age", "role": "role"}.items()}


def optional_user(request: Request):
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        return None
    with connection() as db:
        row = db.execute("""SELECT u.*, s.csrf_hash, s.token_hash FROM sessions s
            JOIN users u ON u.id=s.user_id
            WHERE s.token_hash=? AND s.expires>? AND u.password_reset_required=0""",
            (digest(token), time.time())).fetchone()
    if not row:
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.")
    request.state.user = dict(row)
    return dict(row)


def require_user(user=Depends(optional_user)):
    if not user:
        raise HTTPException(401, "Vui lòng đăng nhập.")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Bạn không có quyền quản trị.")
    return user


def check_csrf(request: Request, user):
    if user and not hmac.compare_digest(digest(request.headers.get("x-csrf-token", "")), user["csrf_hash"]):
        raise HTTPException(403, "Yêu cầu không hợp lệ (CSRF).")


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=1, max_length=128)


class Register(Login):
    password: str = Field(min_length=12, max_length=128)
    age: int = Field(default=18, ge=1, le=120)
    display_name: str | None = Field(default=None, max_length=100)


@router.post("/register", status_code=201)
def register(payload: Register):
    password_hash = hash_password(payload.password)
    user_id = str(uuid.uuid4())
    username = payload.username.lower()
    try:
        with connection() as db:
            db.execute("""INSERT INTO users(id,username,password_hash,role,age,display_name)
                VALUES(?,?,?,'user',?,?)""", (user_id, username, password_hash, payload.age, payload.display_name or username))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Tên đăng nhập đã được sử dụng.")
    return {"success": True}


@router.post("/login")
def login(payload: Login, response: Response, request: Request):
    username = payload.username.lower()
    rate_limit("account:" + digest(username), 10, 900)
    with connection() as db:
        row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    valid = False
    legacy = False
    if not hash_slots.acquire(blocking=False):
        raise HTTPException(429, "Máy chủ đang bận, vui lòng thử lại.")
    try:
        if row and not row["password_reset_required"]:
            stored = row["password_hash"]
            legacy = len(stored) == 64 and all(c in "0123456789abcdef" for c in stored)
            try:
                valid = hmac.compare_digest(digest(payload.password), stored) if legacy else hasher.verify(stored, payload.password)
            except (VerificationError, InvalidHashError):
                pass
        if not valid:
            # Perform work for nonexistent/legacy accounts to reduce timing differences.
            hasher.hash(payload.password)
    finally:
        hash_slots.release()
    if not valid:
        raise HTTPException(401, "Sai thông tin đăng nhập hoặc tài khoản cần đặt lại mật khẩu.")
    token = secrets.token_urlsafe(32)
    csrf = digest("csrf:" + token)
    replacement = hash_password(payload.password) if legacy or hasher.check_needs_rehash(row["password_hash"]) else None
    with connection() as db:
        if replacement:
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (replacement, row["id"]))
        old = request.cookies.get(config.COOKIE_NAME)
        if old:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(old),))
        db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
        db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (digest(token), row["id"], digest(csrf), time.time()+config.SESSION_SECONDS))
    response.set_cookie(config.COOKIE_NAME, token, max_age=config.SESSION_SECONDS, httponly=True,
                        secure=config.COOKIE_SECURE, samesite=config.COOKIE_SAMESITE, path="/")
    return {"user": public_user(row), "csrf_token": csrf}


@router.get("/me")
def me(request: Request, response: Response, user=Depends(require_user)):
    # CSRF secret is deterministic from the opaque session token, so tabs can restore it
    # without rotating another tab's token.
    csrf = digest("csrf:" + request.cookies[config.COOKIE_NAME])
    with connection() as db:
        db.execute("UPDATE sessions SET csrf_hash=? WHERE token_hash=?", (digest(csrf), user["token_hash"]))
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(user), "csrf_token": csrf}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(config.COOKIE_NAME)
    if token:
        with connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))
    response.delete_cookie(config.COOKIE_NAME, path="/", secure=config.COOKIE_SECURE, samesite=config.COOKIE_SAMESITE)
    return {"success": True}


@router.get("/users")
def users(user=Depends(require_admin)):
    with connection() as db:
        rows = db.execute("SELECT * FROM users ORDER BY created_at DESC LIMIT 1000").fetchall()
    return {"users": [public_user(row) for row in rows]}
