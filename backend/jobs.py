"""SQLite leases coordinate processes sharing the same local database file."""
import asyncio
import json
import time
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from .db import connection
from .security import require_admin

router = APIRouter()


def claim(name, seconds=600, due=False):
    now = time.time()
    owner = str(uuid.uuid4())
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO jobs(name) VALUES(?)", (name,))
        row = db.execute("SELECT * FROM jobs WHERE name=?", (name,)).fetchone()
        if row["lease_until"] > now or (due and (row["interval_seconds"] == 0 or row["next_run"] > now)):
            return None
        db.execute("UPDATE jobs SET owner=?,lease_until=?,last_started=?,status='running',error=NULL WHERE name=?",
                   (owner,now+seconds,now,name))
    return owner


def finish(name, owner, report=None, error=None):
    now=time.time()
    with connection() as db:
        db.execute("""UPDATE jobs SET lease_until=0,last_finished=?,next_run=?+interval_seconds,
            status=?,error=?,report=? WHERE name=? AND owner=?""",
            (now,now,"error" if error else "success",error,json.dumps(report or {},ensure_ascii=False),name,owner))


def guarded_write(owner, callback):
    # Hold the SQLite writer lock across the cloud commit, preventing lease takeover
    # between the ownership check and the external write.
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT owner,lease_until FROM jobs WHERE name='auto-update'").fetchone()
        if not row or row["owner"] != owner or row["lease_until"] <= time.time():
            raise HTTPException(409,"Tác vụ đã hết quyền thực thi.")
        return callback()


def state():
    with connection() as db:
        row=db.execute("SELECT * FROM jobs WHERE name='auto-update'").fetchone()
    if not row:
        return {"interval_seconds":0,"status":"idle","last_finished":None}
    result=dict(row)
    result.pop("owner",None)
    if result["status"]=="running" and result["lease_until"]<=time.time():
        result["status"]="interrupted"
    result["report"]=json.loads(result.get("report") or "{}")
    return result


class Schedule(BaseModel):
    model_config=ConfigDict(extra="forbid")
    interval_seconds:int=Field(ge=0,le=86400)


@router.get("/api/admin/auto-update")
def status(user=Depends(require_admin)):
    return state()


@router.put("/api/admin/auto-update")
def configure(payload:Schedule,user=Depends(require_admin)):
    if payload.interval_seconds and payload.interval_seconds<120:
        raise HTTPException(422,"Chu kỳ tối thiểu 120 giây.")
    with connection() as db:
        db.execute("INSERT OR IGNORE INTO jobs(name) VALUES('auto-update')")
        db.execute("UPDATE jobs SET interval_seconds=?,next_run=? WHERE name='auto-update'",(payload.interval_seconds,time.time()+payload.interval_seconds))
    return state()


async def scheduler_loop(run):
    while True:
        await asyncio.sleep(15)
        try:
            await run(due=True)
        except asyncio.CancelledError:
            raise
        except Exception:
            # run() records a sanitized error in the durable job state.
            continue


def owns(name,owner):
    with connection() as db:
        row=db.execute("SELECT owner,lease_until FROM jobs WHERE name=?",(name,)).fetchone()
    return bool(row and row["owner"]==owner and row["lease_until"]>time.time())


@router.post("/api/admin/auto-update/stop")
def stop(user=Depends(require_admin)):
    with connection() as db:
        db.execute("UPDATE jobs SET owner=NULL,lease_until=0,status='interrupted',next_run=?+interval_seconds WHERE name='auto-update'",(time.time(),))
    return state()
