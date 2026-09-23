"""User interactions stay in SQLite. Catalog reads never fall back to this database."""
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from . import catalog
from .db import connection
from .security import require_user, optional_user, require_admin

router = APIRouter()
PRODUCT_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def day_bounds(now=None):
    now = (now or datetime.now(timezone.utc)).astimezone(PRODUCT_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return tuple(x.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") for x in (start, start+timedelta(days=1)))


def is_series(movie):
    kind = str(movie.get("type", "")).lower()
    category = str(movie.get("category", "")).lower()
    genres = str(movie.get("genres", "")).lower()
    if movie.get("chieurap") or kind == "single" or "phim lẻ" in category or "chiếu rạp" in category:
        return False
    return kind in {"series", "hoathinh", "tvshows"} or "phim bộ" in category or "phim bộ" in genres


@router.post("/api/movies/{movie_id}/view")
def record_view(movie_id: str, user=Depends(require_user)):
    catalog.get_movie(movie_id)
    bucket = int(time.time()) // 1800
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM view_receipts WHERE bucket < ?", (bucket-2,))
        inserted = db.execute("INSERT OR IGNORE INTO view_receipts VALUES(?,?,?)", (user["id"], movie_id, bucket)).rowcount
        if inserted:
            db.execute("""INSERT INTO movie_views(movie_id,views) VALUES(?,1)
                ON CONFLICT(movie_id) DO UPDATE SET views=views+1,updated_at=CURRENT_TIMESTAMP""", (movie_id,))
            db.execute("INSERT INTO view_logs(movie_id) VALUES(?)", (movie_id,))
        row = db.execute("SELECT views FROM movie_views WHERE movie_id=?", (movie_id,)).fetchone()
    return {"status": "success", "views": row["views"] if row else 0, "counted": bool(inserted)}


@router.get("/api/movies/{movie_id}/stats")
def stats(movie_id: str, user=Depends(optional_user)):
    catalog.valid_id(movie_id)
    with connection() as db:
        row = db.execute("SELECT views FROM movie_views WHERE movie_id=?", (movie_id,)).fetchone()
        likes = db.execute("SELECT count(*) FROM user_movie_likes WHERE movie_id=?", (movie_id,)).fetchone()[0]
        liked = bool(user and db.execute("SELECT 1 FROM user_movie_likes WHERE movie_id=? AND user_id=?", (movie_id,user["id"])).fetchone())
        comments = db.execute("SELECT count(*) FROM movie_comments WHERE movie_id=?", (movie_id,)).fetchone()[0]
    return {"movie_id":movie_id,"views": row["views"] if row else 0,"likes_count":likes,"is_liked":liked,"comments_count":comments}


class Like(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_liked: bool | None = None


@router.post("/api/movies/{movie_id}/like")
def like(movie_id: str, payload: Like, user=Depends(require_user)):
    catalog.get_movie(movie_id)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT 1 FROM user_movie_likes WHERE user_id=? AND movie_id=?", (user["id"],movie_id)).fetchone()
        desired = payload.is_liked if payload.is_liked is not None else not bool(old)
        if desired:
            db.execute("INSERT OR IGNORE INTO user_movie_likes(user_id,movie_id) VALUES(?,?)", (user["id"],movie_id))
        else:
            db.execute("DELETE FROM user_movie_likes WHERE user_id=? AND movie_id=?", (user["id"],movie_id))
        total = db.execute("SELECT count(*) FROM user_movie_likes WHERE movie_id=?", (movie_id,)).fetchone()[0]
    return {"is_liked":desired,"total_likes":total}


@router.get("/api/user/{user_id}/favorites")
def favorites(user_id: str, user=Depends(require_user)):
    if user_id not in {user["id"], user["username"], "me"}:
        raise HTTPException(403, "Không được truy cập tài nguyên của người khác.")
    with connection() as db:
        rows = db.execute("SELECT movie_id FROM user_movie_likes WHERE user_id=? ORDER BY created_at DESC", (user["id"],)).fetchall()
    return {"favorites":[r["movie_id"] for r in rows]}


@router.get("/api/leaderboard/trending")
@router.get("/api/trending")
def trending(limit: int=Query(10, ge=1, le=100)):
    with connection() as db:
        rows = db.execute("SELECT movie_id,views FROM movie_views WHERE views>0 ORDER BY views DESC,movie_id LIMIT ?", (limit,)).fetchall()
    return {"timeframe":"all_time","trending":[dict(r) for r in rows]}


@router.get("/api/leaderboard/today-series")
def today_series(limit: int=Query(10, ge=1, le=100)):
    movies = {m["id"]:m for m in catalog.all_movies() if is_series(m)}
    with connection() as db:
        rows = db.execute("""SELECT movie_id,count(*) AS views FROM view_logs
            WHERE created_at>=? AND created_at<? GROUP BY movie_id ORDER BY views DESC,movie_id""", day_bounds()).fetchall()
    return {"timeframe":"today","timezone":"Asia/Ho_Chi_Minh","trending":[dict(r) for r in rows if r["movie_id"] in movies][:limit]}


@router.get("/api/leaderboard/favorites")
def favorite_ranking(limit: int=Query(10, ge=1, le=100)):
    with connection() as db:
        rows = db.execute("SELECT movie_id,count(*) AS like_count FROM user_movie_likes GROUP BY movie_id ORDER BY like_count DESC,movie_id LIMIT ?", (limit,)).fetchall()
    return {"favorites":[dict(r) for r in rows]}


@router.get("/api/comments/latest")
@router.get("/api/leaderboard/comments")
def latest_comments(limit: int=Query(10, ge=1, le=100)):
    with connection() as db:
        rows = db.execute("SELECT * FROM movie_comments ORDER BY created_at DESC,id DESC LIMIT ?", (limit,)).fetchall()
    return {"comments":[dict(r) for r in rows]}


@router.get("/api/movies/{movie_id}/comments")
def comments(movie_id: str, limit: int=Query(100,ge=1,le=100), offset: int=Query(0,ge=0)):
    catalog.valid_id(movie_id)
    with connection() as db:
        rows = db.execute("SELECT * FROM movie_comments WHERE movie_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (movie_id,limit,offset)).fetchall()
    return {"comments":[dict(r) for r in rows], "next_offset":offset+limit if len(rows)==limit else None}


class Comment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1,max_length=2000)


@router.post("/api/movies/{movie_id}/comments", status_code=201)
def add_comment(movie_id: str, payload: Comment, user=Depends(require_user)):
    catalog.get_movie(movie_id)
    content = payload.content.strip()
    if not content:
        raise HTTPException(422, "Bình luận không được để trống.")
    comment_id = str(uuid.uuid4())
    with connection() as db:
        db.execute("INSERT INTO movie_comments(id,movie_id,user_id,username,avatar,content) VALUES(?,?,?,?,?,?)",
                   (comment_id,movie_id,user["id"],user["display_name"] or user["username"],"",content))
        row = db.execute("SELECT * FROM movie_comments WHERE id=?", (comment_id,)).fetchone()
    return {"status":"success","comment":dict(row)}


@router.get("/api/admin/stats")
def dashboard(user=Depends(require_admin)):
    movies = catalog.all_movies()
    with connection() as db:
        count = db.execute("SELECT count(*) FROM view_logs WHERE created_at>=? AND created_at<?", day_bounds()).fetchone()[0]
    return {"total_movies":len(movies),"today_views":count,"firestore":"connected",
            "source":"Firestore catalog / SQLite view_logs","timezone":"Asia/Ho_Chi_Minh",
            "as_of":datetime.now(timezone.utc).isoformat()}
