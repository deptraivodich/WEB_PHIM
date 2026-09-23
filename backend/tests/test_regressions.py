"""Regression tests use a temporary SQLite DB and an in-process Firestore double."""
import asyncio
import copy
import hashlib
import importlib
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import config, db, catalog, security, jobs, telemetry, crawler, safe_http, interactions, chat
from backend.main import app


class Snapshot:
    def __init__(self, ref, data):
        self.id=ref.id
        self.reference=ref
        self.exists=data is not None
        self.data=copy.deepcopy(data)
    def to_dict(self):
        return copy.deepcopy(self.data)


class Reference:
    def __init__(self, store, collection, key):
        self.store,self.collection,self.id=store,collection,key
    def get(self, **kwargs):
        if self.store.fail:
            raise RuntimeError("simulated cloud outage")
        return Snapshot(self,self.store.data.get((self.collection,self.id)))
    def set(self, data, **kwargs):
        if self.store.fail:
            raise RuntimeError("simulated cloud outage")
        self.store.data[(self.collection,self.id)]=copy.deepcopy(data)


class Collection:
    def __init__(self, store, name):
        self.store,self.name=store,name
        self.cursor=""
        self.maximum=100000
    def document(self,key):
        return Reference(self.store,self.name,key)
    def order_by(self, *args):
        return self
    def start_after(self,data):
        self.cursor=next(iter(data.values())).id
        return self
    def limit(self,number):
        self.maximum=number
        return self
    def stream(self, **kwargs):
        if self.store.fail:
            raise RuntimeError("simulated cloud outage")
        keys=sorted(k for collection,k in self.store.data if collection==self.name and k>self.cursor)
        return [self.document(k).get() for k in keys[:self.maximum]]


class Transaction:
    def __init__(self,store):
        self.store=store
    def set(self,ref,data):
        ref.set(data)
    def delete(self,ref):
        self.store.data.pop((ref.collection,ref.id),None)


class Store:
    def __init__(self):
        self.data={}
        self.fail=False
        self.lock=threading.Lock()
    def collection(self,name):
        return Collection(self,name)
    def transaction(self):
        return Transaction(self)
    def transactional(self,fn):
        def wrapped(tx):
            with self.lock:
                before=copy.deepcopy(self.data)
                try:
                    return fn(tx)
                except BaseException:
                    self.data=before
                    raise
        return wrapped


PASSWORD="test-only-LongPassword!"
MOVIE={"title":"Series A","originalTitle":"Series A","year":"2026","type":"series","status":"ongoing",
       "episodes":[{"name":"1","url":"https://media.example.test/1.m3u8"}],"episodeCurrent":"Tập 1"}


@pytest.fixture
def env(tmp_path,monkeypatch):
    monkeypatch.setattr(config,"DB_PATH",tmp_path/"isolated.db")
    monkeypatch.setenv("CLICKHOUSE_ENABLED","false")
    monkeypatch.delenv("GEMINI_API_KEY",raising=False)
    monkeypatch.setattr(telemetry,"client",None)
    def forbidden(*args,**kwargs):
        raise AssertionError("Tests must not access a real network")
    monkeypatch.setattr(safe_http, "public_addresses", forbidden)
    from firebase_admin import firestore
    store=Store()
    monkeypatch.setattr(catalog,"client",lambda:store)
    monkeypatch.setattr(firestore,"transactional",store.transactional)
    with TestClient(app) as client:
        client.headers["X-Requested-With"]="WEB_PHIM"
        client.headers["Origin"]="http://localhost:3000"
        yield client,store


def login(client,role="user",name="tester"):
    with db.connection() as conn:
        conn.execute("INSERT OR IGNORE INTO users(id,username,password_hash,role,display_name) VALUES(?,?,?,?,?)",
                     (name+"-id",name,security.hash_password(PASSWORD),role,name))
    response=client.post("/api/auth/login",json={"username":name,"password":PASSWORD})
    assert response.status_code==200,response.text
    client.headers["X-CSRF-Token"]=response.json()["csrf_token"]
    return response


def seed(store,key="movie-a",data=None):
    store.data[("movies",key)]=copy.deepcopy(data or MOVIE)


@pytest.mark.parametrize("method,path,body",[
    ("GET","/api/auth/users",None),("GET","/api/admin/stats",None),
    ("GET","/api/admin/auto-update",None),("PUT","/api/settings/homepage",{}),
    ("POST","/api/catalog/new",MOVIE),("PUT","/api/catalog/movie-a",MOVIE),
    ("DELETE","/api/catalog/movie-a",None),("POST","/api/movies/sync",{"movies":[]}),
    ("POST","/api/crawl",{"url":"valid-slug"}),("POST","/api/movies/auto-update",{}),
])
@pytest.mark.parametrize("role,expected",[(None,401),("user",403)])
def test_admin_matrix(env,method,path,body,role,expected):
    client,store=env
    seed(store)
    if role:
        login(client,role)
    response=client.request(method,path,json=body)
    assert response.status_code==expected,response.text


def test_public_reads_and_user_ownership(env):
    client,store=env
    seed(store)
    for path in ["/health","/api/movies","/api/catalog/movie-a","/api/settings/homepage",
                 "/api/leaderboard/trending","/api/leaderboard/today-series","/api/movies/movie-a/comments"]:
        assert client.get(path).status_code==200
    assert client.post("/api/movies/movie-a/like",json={}).status_code==401
    login(client)
    assert client.get("/api/user/someone-else/favorites").status_code==403
    assert client.post("/api/movies/movie-a/like",json={"user_id":"victim","role":"admin"}).status_code==422
    assert client.post("/api/movies/movie-a/like",json={"is_liked":True}).status_code==200
    assert client.post("/api/movies/movie-a/like",json={"is_liked":True}).json()["total_likes"]==1
    assert client.get("/api/user/me/favorites").json()["favorites"]==["movie-a"]
    assert client.get("/api/movies/movie-a/stats?user_id=victim").json()["is_liked"] is True
    assert client.post("/api/movies/movie-a/comments",json={"content":"hello","username":"Admin"}).status_code==422
    comment=client.post("/api/movies/movie-a/comments",json={"content":"hello"}).json()["comment"]
    assert comment["user_id"]=="tester-id"
    assert comment["username"]=="tester"


def test_sessions_csrf_expiry_logout(env):
    client,_=env
    response=login(client)
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    assert client.get("/api/auth/me").json()["user"]["role"]=="user"
    csrf=client.headers.pop("X-CSRF-Token")
    assert client.post("/api/auth/logout").status_code==403
    client.headers["X-CSRF-Token"]=csrf
    client.headers["Origin"]="https://attacker.example"
    assert client.post("/api/auth/logout").status_code==403
    client.headers["Origin"]="http://localhost:3000"
    assert client.post("/api/auth/logout").status_code==200
    assert client.get("/api/auth/me").status_code==401
    login(client)
    with db.connection() as conn:
        conn.execute("UPDATE sessions SET expires=0")
    assert client.get("/api/auth/me").status_code==401
    assert client.post("/api/auth/logout").status_code==200
    client.cookies.set(config.COOKIE_NAME,'{"role":"admin","id":"tester-id"}')
    assert client.get("/api/auth/users").status_code==401


def test_registration_hash_and_legacy_upgrade(env):
    client,_=env
    response=client.post("/api/auth/register",json={"username":"newuser","password":PASSWORD,"age":18})
    assert response.status_code==201
    with db.connection() as conn:
        row=conn.execute("SELECT password_hash FROM users WHERE username='newuser'").fetchone()
        assert row[0].startswith("$argon2id$")
        conn.execute("INSERT INTO users(id,username,password_hash,role) VALUES('legacy-id','legacy',?,'user')",
                     (hashlib.sha256(PASSWORD.encode()).hexdigest(),))
    assert client.post("/api/auth/login",json={"username":"legacy","password":PASSWORD}).status_code==200
    with db.connection() as conn:
        assert conn.execute("SELECT password_hash FROM users WHERE id='legacy-id'").fetchone()[0].startswith("$argon2id$")
    bad=client.post("/api/auth/register",json={"username":"newadmin","password":PASSWORD,"role":"admin"})
    assert bad.status_code==422
    assert PASSWORD not in bad.text


def test_cloud_crud_retry_delete_sync(env):
    client,store=env
    login(client,"admin")
    path="/api/catalog/imported_stable"
    first=client.post(path,json=MOVIE)
    assert first.status_code==201,first.text
    assert first.json()["id"]=="imported_stable"
    assert client.post(path,json=MOVIE).json()["_revision"]==1
    updated={**first.json(),"title":"Changed"}
    saved=client.put(path,json=updated)
    assert saved.status_code==200
    assert client.put(path,json=updated).json()["_revision"]==2
    assert client.put(path,json={**first.json(),"title":"Stale edit"}).status_code==409
    store.data[("settings","homepage_layout")]={"top10Movies":["imported_stable","other"]}
    assert client.delete(path).status_code==200
    assert client.delete(path).status_code==200
    assert client.get(path).status_code==404
    assert store.data[("settings","homepage_layout")]["top10Movies"]==["other"]
    assert client.post("/api/movies/sync",json={"movies":[{**MOVIE,"id":"imported_stable"}]}).status_code==409
    store.fail=True
    assert client.post("/api/catalog/cloud-fail",json=MOVIE).status_code==503
    assert ("movies","cloud-fail") not in store.data
    assert client.get("/api/movies").status_code==503


def test_pagination_and_stale_cache_conflicts(env):
    client,store=env
    login(client,"admin")
    for i in range(305):
        seed(store,f"id-{i:04}",{**MOVIE,"title":f"Title {i}"})
    movies=[]
    cursor=""
    while True:
        data=client.get("/api/movies",params={"limit":100,"cursor":cursor}).json()
        movies.extend(data["movies"])
        cursor=data["next_cursor"]
        if not cursor:
            break
    assert len(movies)==305
    assert len({m["id"] for m in movies})==305
    payload={"movies":[{**movies[0],"id":"local-different"}]}
    assert client.post("/api/movies/sync",json=payload).status_code==409
    assert client.get("/api/movies?limit=100000").status_code==422


@pytest.mark.parametrize("url",[
    "http://phimapi.com/phim/a","https://evil.test/phim/a",
    "https://phimapi.com.evil.test/v1/api/danh-sach/a",
    "https://evil.test/?url=phimapi.com/v1/api/a",
    "https://phimapi.com@evil.test/phim/a","https://phimapi.com:444/phim/a",
    "https://phimapi.com/phim/../a","https://phimapi.com/phim/a%2fb",
    "https://127.0.0.1/phim/a","https://phimapi.com/v1/api/danh-sach/a?limit=500",
    "valid-slug?url=anything",
])
def test_crawler_rejects_urls_without_network(url):
    with pytest.raises(HTTPException):
        safe_http.classify_crawl_url(url)


def test_ssrf_dns_redirect_limits(monkeypatch):
    monkeypatch.setattr(socket,"getaddrinfo",lambda *a,**k:[(None,None,None,None,("127.0.0.1",443))])
    with pytest.raises(HTTPException):
        safe_http.public_addresses("phimapi.com")
    conn=Mock()
    response=Mock(status=302)
    conn.getresponse.return_value=response
    monkeypatch.setattr(safe_http,"PinnedHTTPSConnection",lambda *a,**k:conn)
    with pytest.raises(HTTPException) as exc:
        safe_http.fetch_json("https://phimapi.com/phim/test")
    assert exc.value.status_code==502
    assert conn.request.call_count==1
    response.status=200
    response.getheader.return_value=str(safe_http.MAX_BYTES+1)
    with pytest.raises(HTTPException):
        safe_http.fetch_json("test")
    response.read.assert_not_called()


def test_invalid_sql_input_and_telemetry(env):
    client,store=env
    seed(store)
    login(client)
    assert client.get("/api/movies/x%27%20OR%201=1--/stats").status_code==422
    event={"event_id":str(uuid.uuid4()),"movie_id":"movie-a","action_type":"click_poster"}
    assert client.post("/api/track",json=event).status_code==202
    assert client.post("/api/track",json=event).json()["status"]=="duplicate"
    assert client.post("/api/track",json={**event,"action_type":"click"}).status_code==422
    assert client.post("/api/track",json={**event,"user_id":"victim"}).status_code==422
    with db.connection() as conn:
        import json
        rows=conn.execute("SELECT payload FROM telemetry_outbox").fetchall()
        assert len(rows)==1 and json.loads(rows[0][0])["user_id"]=="tester-id"
    assert telemetry.flush() is False
    with db.connection() as conn:
        assert conn.execute("SELECT count(*) FROM telemetry_outbox WHERE delivered=0").fetchone()[0]==1


def test_daily_stats_timezone_and_view_dedupe(env):
    client,store=env
    seed(store)
    seed(store,"single",{**MOVIE,"type":"single"})
    login(client,"admin")
    assert client.post("/api/movies/movie-a/view").json()["counted"] is True
    assert client.post("/api/movies/movie-a/view").json()["counted"] is False
    start,end=interactions.day_bounds()
    with db.connection() as conn:
        conn.execute("INSERT INTO view_logs(movie_id,created_at) VALUES('movie-a',?)",(start,))
        conn.execute("INSERT INTO view_logs(movie_id,created_at) VALUES('movie-a',?)",(end,))
        conn.execute("INSERT INTO view_logs(movie_id,created_at) VALUES('single',?)",(start,))
    stats=client.get("/api/admin/stats?total_movies=9000").json()
    assert stats["total_movies"]==2 and stats["today_views"]==3
    daily=client.get("/api/leaderboard/today-series").json()
    assert daily["trending"]==[{"movie_id":"movie-a","views":2}]
    assert interactions.day_bounds(datetime(2026,9,23,18,tzinfo=timezone.utc))==("2026-09-23 17:00:00","2026-09-24 17:00:00")


def test_shared_scheduler_lock_and_fencing(env):
    client,store=env
    with ThreadPoolExecutor(max_workers=4) as executor:
        claims=list(executor.map(lambda _:jobs.claim("auto-update"),range(4)))
    owners=[value for value in claims if value]
    assert len(owners)==1
    login(client,"admin")
    assert client.post("/api/movies/auto-update",json={}).status_code==409
    assert client.post("/api/admin/auto-update/stop").status_code==200
    callback=Mock()
    with pytest.raises(HTTPException):
        jobs.guarded_write(owners[0],callback)
    callback.assert_not_called()
    assert client.put("/api/admin/auto-update",json={"interval_seconds":120}).status_code==200
    assert client.get("/api/admin/auto-update").json()["interval_seconds"]==120
    assert jobs.claim("auto-update",due=True) is None


def test_auto_update_cloud_failure_is_reported(env,monkeypatch):
    client,store=env
    seed(store)
    login(client,"admin")
    async def fake(url):
        return {"status":True,"movie":{"status":"ongoing","episode_current":"Tập 2"},
                "episodes":[{"server_data":[{"name":"2","link_m3u8":"https://media.example.test/2.m3u8"}]}]}
    monkeypatch.setattr(crawler,"get_json",fake)
    response=client.post("/api/movies/auto-update",json={})
    assert response.status_code==200
    assert response.json()["updated_count"]==1
    assert len(store.data[("movies","movie-a")]["episodes"])==2
    monkeypatch.setattr(catalog,"save_movie",lambda *a,**k: (_ for _ in ()).throw(HTTPException(503,"cloud down")))
    response=client.post("/api/movies/auto-update",json={})
    assert response.json()["status"]=="partial"
    assert response.json()["updated_count"]==0
    assert jobs.state()["status"]=="error"


def test_chat_identity_history_no_fake_data(env):
    client,store=env
    assert client.post("/api/chat",json={"message":"hello"}).status_code==401
    login(client)
    assert client.post("/api/chat",json={"message":"hello","user_id":"victim"}).status_code==422
    empty=client.post("/api/chat",json={"message":"hello"})
    assert empty.status_code==200 and empty.json()["data_status"]=="empty"
    seed(store)
    assert client.post("/api/chat",json={"message":"hello"}).status_code==503
    chat.append_history("tester-id","mine","reply")
    chat.append_history("other-id","private","secret")
    assert "private" not in str(chat.history("tester-id"))
    assert client.delete("/api/chat/history").status_code==200
    assert chat.history("tester-id")==[]


def test_rate_limit_and_payload_size(env):
    client,_=env
    statuses=[client.post("/api/auth/login",json={"username":"missing","password":PASSWORD}).status_code for _ in range(11)]
    assert statuses[-1]==429
    result=client.post("/api/auth/register",content=b"x"*(config.MAX_BODY_BYTES+1))
    # Rate limiting may reject first; use a read-independent write route for body limit.
    result=client.post("/api/track",content=b"x"*(config.MAX_BODY_BYTES+1))
    assert result.status_code==413


def test_migration_backup_repeat_and_legacy_links(tmp_path,monkeypatch):
    monkeypatch.setattr(config,"DB_PATH",tmp_path/"old.db")
    con=sqlite3.connect(config.DB_PATH)
    con.executescript(db.BASE_SQL)
    con.execute("INSERT INTO users(id,username,password_hash) VALUES('u1','legacy',?)",(db.DEFAULT_PASSWORD_HASHES[0],))
    con.execute("INSERT INTO user_movie_likes(user_id,movie_id) VALUES('legacy','unchanged-movie-id')")
    con.commit()
    con.close()
    db.migrate()
    db.migrate()
    assert len(list(tmp_path.glob("*.bak")))==1
    with db.connection() as conn:
        assert conn.execute("SELECT password_reset_required FROM users").fetchone()[0]==1
        assert tuple(conn.execute("SELECT user_id,movie_id FROM user_movie_likes").fetchone())==("u1","unchanged-movie-id")


def test_import_has_no_database_side_effect(tmp_path):
    env={**os.environ,"SQLITE_PATH":str(tmp_path/"never-created.db"),"CLICKHOUSE_ENABLED":"false","PYTHONDONTWRITEBYTECODE":"1"}
    result=subprocess.run([sys.executable,"-B","-c","import backend.main"],env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    assert not (tmp_path/"never-created.db").exists()
