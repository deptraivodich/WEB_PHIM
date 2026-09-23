"""Bounded durable outbox. Delivery to ClickHouse is at least once, dedupe by event_id."""
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from . import jobs, catalog
from .db import connection
from .security import optional_user

router=APIRouter()
client=None
MAX_PENDING=10000
BATCH_SIZE=100


class TelemetryEvent(BaseModel):
    model_config=ConfigDict(extra="forbid")
    event_id:UUID
    session_id:str=Field(default="",max_length=100)
    movie_id:str=Field(min_length=1,max_length=160)
    action_type:Literal["click_poster","view_detail","play","pause","seek","heartbeat","search","complete"]
    watch_time:int=Field(default=0,ge=0,le=3600)
    video_quality:str=Field(default="",max_length=32)
    device_type:str=Field(default="web",max_length=32)


def get_client():
    global client
    if os.getenv("CLICKHOUSE_ENABLED","false").lower()!="true":
        return None
    if client is None:
        import clickhouse_connect
        password=os.getenv("CLICKHOUSE_PASSWORD")
        if not password:
            return None
        client=clickhouse_connect.get_client(host=os.getenv("CLICKHOUSE_HOST","localhost"),
            port=int(os.getenv("CLICKHOUSE_PORT","8123")),database=os.getenv("CLICKHOUSE_DB","web_phim"),
            username=os.getenv("CLICKHOUSE_USER","default"),password=password,
            connect_timeout=3,send_receive_timeout=10)
    return client


@router.post("/api/track",status_code=202)
def track(payload:TelemetryEvent,user=Depends(optional_user)):
    catalog.valid_id(payload.movie_id)
    identity=user["id"] if user else "anonymous"
    data=payload.model_dump(mode="json")
    data.update(user_id=identity,created_at=datetime.now(timezone.utc).isoformat())
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM telemetry_outbox WHERE delivered=1 AND received<?",(time.time()-86400,))
        existing=db.execute("SELECT 1 FROM telemetry_outbox WHERE event_id=?",(str(payload.event_id),)).fetchone()
        if existing:
            return {"status":"duplicate"}
        if db.execute("SELECT count(*) FROM telemetry_outbox WHERE delivered=0").fetchone()[0]>=MAX_PENDING:
            raise HTTPException(503,"Hàng đợi telemetry đã đầy.",headers={"Retry-After":"60"})
        db.execute("INSERT INTO telemetry_outbox(event_id,payload,received) VALUES(?,?,?)",
                   (str(payload.event_id),json.dumps(data),time.time()))
    return {"status":"accepted"}


def flush():
    global client
    owner=jobs.claim("telemetry-flush",120)
    if not owner:
        return True
    try:
        with connection() as db:
            rows=db.execute("SELECT event_id,payload FROM telemetry_outbox WHERE delivered=0 ORDER BY received LIMIT ?",(BATCH_SIZE,)).fetchall()
        if not rows:
            return True
        ch=get_client()
        if ch is None:
            return False
        data=[]
        for row in rows:
            e=json.loads(row["payload"])
            data.append([UUID(e["event_id"]),e["user_id"],e["session_id"],e["movie_id"],e["action_type"],e["watch_time"],
                         e["video_quality"],e["device_type"],"",datetime.fromisoformat(e["created_at"])])
        ch.insert("user_telemetry_events",data,column_names=["event_id","user_id","session_id","movie_id","action_type",
                   "watch_time","video_quality","device_type","ip_address","created_at"])
        with connection() as db:
            db.executemany("UPDATE telemetry_outbox SET delivered=1 WHERE event_id=?",[(row["event_id"],) for row in rows])
        return True
    except Exception:
        client=None
        return False
    finally:
        jobs.finish("telemetry-flush",owner)


async def flush_loop():
    delay=5
    while True:
        await asyncio.sleep(delay)
        okay=await asyncio.to_thread(flush)
        delay=5 if okay else min(delay*2,300)


@router.get("/api/analytics/trending")
def analytics(limit:int=Query(10,ge=1,le=100)):
    try:
        ch=get_client()
        if ch is None:
            raise HTTPException(503,"Thống kê telemetry chưa khả dụng.")
        result=ch.query("""SELECT movie_id, countIf(action_type='play') AS play_count,
            countIf(action_type='view_detail') AS detail_views, sum(watch_time) AS watch_seconds
            FROM (SELECT event_id,any(movie_id) AS movie_id,any(action_type) AS action_type,
                  any(watch_time) AS watch_time FROM user_telemetry_events
                  WHERE created_at>=now()-INTERVAL 7 DAY GROUP BY event_id)
            GROUP BY movie_id ORDER BY play_count DESC LIMIT {limit:UInt32}""",parameters={"limit":limit})
        return {"timeframe":"7_days","trending":[dict(zip(["movie_id","play_count","detail_views","total_watch_seconds"],row)) for row in result.result_rows]}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503,"Thống kê telemetry chưa khả dụng.")
