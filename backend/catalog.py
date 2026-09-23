"""Firestore is authoritative for movies/layout. SQLite owns accounts/interactions only."""
import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from .security import require_admin

router = APIRouter()
_client = None
_client_lock = threading.Lock()


def client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                project = os.getenv("FIREBASE_PROJECT_ID")
                if not project:
                    raise HTTPException(503, "Kho phim chưa được cấu hình.")
                import firebase_admin
                from firebase_admin import firestore
                try:
                    app = firebase_admin.get_app()
                except ValueError:
                    app = firebase_admin.initialize_app(options={"projectId": project})
                _client = firestore.client(app)
    return _client


def cloud_call(fn):
    try:
        return fn()
    except HTTPException:
        raise
    except Exception:
        # Never include SDK credentials, request URLs or internals in API errors.
        raise HTTPException(503, "Không thể truy cập kho phim. Chưa xác nhận lưu; hãy tải lại trước khi thử lại.")


def valid_id(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", value):
        raise HTTPException(422, "ID phim không hợp lệ.")
    return value


def movie_key(data):
    identity = "|".join(str(data.get(k) or "").strip().casefold() for k in ("title", "originalTitle", "year"))
    return hashlib.sha256(identity.encode()).hexdigest()


def clean_movie(data):
    data = dict(data)
    for key in ("id", "_revision", "_write_hash"):
        data.pop(key, None)
    if not isinstance(data.get("title"), str) or not 1 <= len(data["title"].strip()) <= 300:
        raise HTTPException(422, "Tên phim không hợp lệ.")
    if data.get("status") in {"new", "update", "duplicate"}:
        raise HTTPException(422, "Trạng thái import không phải trạng thái phát hành.")
    episodes = data.get("episodes", [])
    if not isinstance(episodes, list) or len(episodes) > 3000:
        raise HTTPException(422, "Danh sách tập không hợp lệ.")
    for ep in episodes:
        if not isinstance(ep, dict) or len(str(ep.get("name", ""))) > 100:
            raise HTTPException(422, "Tập phim không hợp lệ.")
        url = ep.get("url") or ep.get("m3u8Url") or ""
        if not isinstance(url, str) or len(url) > 4096 or (url and not re.match(r"^https?://", url)):
            raise HTTPException(422, "Link video không hợp lệ.")
    if len(json.dumps(data, ensure_ascii=False).encode()) > 750_000:
        raise HTTPException(413, "Dữ liệu phim quá lớn.")
    return data


def page(limit=100, cursor=""):
    def run():
        from google.cloud.firestore_v1.field_path import FieldPath
        query = client().collection("movies").order_by(FieldPath.document_id())
        if cursor:
            query = query.start_after({FieldPath.document_id(): client().collection("movies").document(valid_id(cursor))})
        docs = list(query.limit(limit + 1).stream(timeout=15))
        items = [{**d.to_dict(), "id": d.id} for d in docs[:limit]]
        return {"movies": items, "next_cursor": items[-1]["id"] if len(docs) > limit else None}
    return cloud_call(run)


def all_movies():
    result, cursor = [], ""
    while True:
        batch = page(100, cursor)
        result.extend(batch["movies"])
        cursor = batch["next_cursor"]
        if not cursor:
            return result


def get_movie(movie_id):
    def run():
        snap = client().collection("movies").document(valid_id(movie_id)).get(timeout=15)
        if not snap.exists:
            raise HTTPException(404, "Không tìm thấy phim.")
        return {**snap.to_dict(), "id": snap.id}
    return cloud_call(run)


def get_layout():
    def run():
        snap = client().collection("settings").document("homepage_layout").get(timeout=15)
        return snap.to_dict() if snap.exists else {}
    return cloud_call(run)


def save_movie(movie_id, payload, create=False):
    movie_id = valid_id(movie_id)
    data = clean_movie(payload)
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()
    def run():
        from firebase_admin import firestore
        db = client()
        ref = db.collection("movies").document(movie_id)
        tombstone = db.collection("movie_tombstones").document(movie_id)
        transaction = db.transaction()
        @firestore.transactional
        def mutate(tx):
            snap = ref.get(transaction=tx)
            deleted = tombstone.get(transaction=tx)
            if deleted.exists:
                raise HTTPException(409, "Phim đã bị xóa. Không thể phục hồi bằng đồng bộ cũ.")
            old = snap.to_dict() if snap.exists else {}
            if snap.exists and old.get("_write_hash") == fingerprint:
                return {**old, "id": movie_id}
            if create and snap.exists:
                raise HTTPException(409, "ID phim đã tồn tại. Hãy tải lại và cập nhật.")
            if not create and not snap.exists:
                raise HTTPException(404, "Không tìm thấy phim.")
            if not create and payload.get("_revision", 0) != old.get("_revision", 0):
                raise HTTPException(409, "Phim đã thay đổi. Hãy tải lại trước khi sửa.")
            saved = {**data, "_revision": old.get("_revision", 0)+1, "_write_hash": fingerprint}
            tx.set(ref, saved)
            return {**saved, "id": movie_id}
        return mutate(transaction)
    return cloud_call(run)


def delete_movie(movie_id):
    movie_id = valid_id(movie_id)
    def run():
        from firebase_admin import firestore
        db = client()
        ref = db.collection("movies").document(movie_id)
        layout_ref = db.collection("settings").document("homepage_layout")
        @firestore.transactional
        def mutate(tx):
            layout = layout_ref.get(transaction=tx)
            def prune(value):
                if isinstance(value, list):
                    return [prune(x) for x in value if x != movie_id]
                if isinstance(value, dict):
                    return {k: prune(v) for k, v in value.items()}
                return value
            tx.delete(ref)
            tx.set(db.collection("movie_tombstones").document(movie_id), {"deletedAt": datetime.now(timezone.utc)})
            if layout.exists:
                tx.set(layout_ref, prune(layout.to_dict()))
        mutate(db.transaction())
        return {"status": "success"}
    return cloud_call(run)


@router.get("/api/movies")
def list_movies(limit: int = Query(100, ge=1, le=100), cursor: str = ""):
    return page(limit, cursor)


@router.get("/api/catalog/{movie_id}")
def movie(movie_id: str):
    return get_movie(movie_id)


@router.post("/api/catalog/{movie_id}", status_code=201)
def create_movie(movie_id: str, payload: dict, user=Depends(require_admin)):
    return save_movie(movie_id, payload, create=True)


@router.put("/api/catalog/{movie_id}")
def update_movie(movie_id: str, payload: dict, user=Depends(require_admin)):
    return save_movie(movie_id, payload)


@router.delete("/api/catalog/{movie_id}")
def remove_movie(movie_id: str, user=Depends(require_admin)):
    return delete_movie(movie_id)


@router.get("/api/settings/homepage")
def homepage():
    return get_layout()


@router.put("/api/settings/homepage")
def save_homepage(payload: dict, user=Depends(require_admin)):
    if len(json.dumps(payload).encode()) > 100_000:
        raise HTTPException(413, "Cấu hình quá lớn.")
    cloud_call(lambda: client().collection("settings").document("homepage_layout").set(payload, timeout=15))
    return payload


class SyncRequest(BaseModel):
    movies: list[dict] = Field(max_length=25)


@router.post("/api/movies/sync")
def sync(payload: SyncRequest, user=Depends(require_admin)):
    # This is an explicit legacy import, never a background browser cache upload.
    existing = all_movies()
    by_id = {m["id"]: m for m in existing}
    by_key = {movie_key(m): m["id"] for m in existing}
    for item in payload.movies:
        movie_id = valid_id(str(item.get("id", "")))
        clean_movie(item)
        match = by_key.get(movie_key(item))
        if match and match != movie_id:
            raise HTTPException(409, "Phim đã có ID khác trên cloud. Cần đối chiếu ID trước khi nhập.")
        by_key[movie_key(item)] = movie_id
    results = []
    for item in payload.movies:
        movie_id = item["id"]
        # Existing cloud data wins; stale browser caches must never overwrite it.
        if movie_id in by_id:
            results.append({"id": movie_id, "status": "unchanged"})
        else:
            save_movie(movie_id, item, create=True)
            results.append({"id": movie_id, "status": "created"})
    return {"status": "success", "synced_count": len(results), "results": results}
