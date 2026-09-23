"""FastAPI composition. No database initialization or network requests on import."""
import asyncio
from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from . import config, catalog, interactions, security, jobs, crawler, telemetry, chat
from .db import migrate, connection

logger=logging.getLogger("webphim")


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(migrate)
    tasks=[asyncio.create_task(telemetry.flush_loop()),asyncio.create_task(jobs.scheduler_loop(crawler.run_auto_update))]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        await asyncio.to_thread(telemetry.flush)
        if telemetry.client:
            await asyncio.to_thread(telemetry.client.close)


app=FastAPI(title="WEB_PHIM API",version="2.0.0",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=config.ORIGINS,allow_credentials=True,
                   allow_methods=["GET","POST","PUT","DELETE","OPTIONS"],
                   allow_headers=["Content-Type","X-CSRF-Token","X-Requested-With"])


@app.middleware("http")
async def protections(request:Request,call_next):
    try:
        if request.method=="OPTIONS":
            return await call_next(request)
        ip=request.client.host if request.client else "unknown"
        path=request.url.path
        await run_in_threadpool(security.rate_limit,"http:"+ip,600)
        if path.startswith("/api/auth/") and request.method=="POST":
            await run_in_threadpool(security.rate_limit,"auth-ip:"+ip,10,900)
        elif path=="/api/crawl" or path=="/api/movies/auto-update":
            await run_in_threadpool(security.rate_limit,"crawler-ip:"+ip,30)
        elif path=="/api/chat" and request.method=="POST":
            await run_in_threadpool(security.rate_limit,"chat-ip:"+ip,10)
        elif path=="/api/track":
            await run_in_threadpool(security.rate_limit,"telemetry-ip:"+ip,120)
        elif request.method in {"POST","PUT","DELETE"}:
            await run_in_threadpool(security.rate_limit,"write-ip:"+ip,120)
        if request.method not in {"GET","HEAD","OPTIONS"}:
            origin=request.headers.get("origin")
            if origin and origin not in config.ORIGINS:
                raise HTTPException(403,"Nguồn yêu cầu không được phép.")
            if request.headers.get("x-requested-with")!="WEB_PHIM":
                raise HTTPException(403,"Thiếu thông tin bảo vệ yêu cầu.")
            if path not in {"/api/auth/login","/api/auth/register"}:
                try:
                    user=await run_in_threadpool(security.optional_user,request)
                except HTTPException:
                    if path!="/api/auth/logout":
                        raise
                    user=None
                security.check_csrf(request,user)
            parts=[]
            total=0
            async for part in request.stream():
                total+=len(part)
                if total>config.MAX_BODY_BYTES:
                    raise HTTPException(413,"Yêu cầu quá lớn.")
                parts.append(part)
            request._body=b"".join(parts)
        response=await call_next(request)
        response.headers["X-Content-Type-Options"]="nosniff"
        if path.startswith("/api/auth") or path.startswith("/api/admin") or path.startswith("/api/user"):
            response.headers["Cache-Control"]="no-store"
        return response
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code,content={"detail":exc.detail},headers=exc.headers)
    except Exception as exc:
        logger.error("Request failed (%s)",type(exc).__name__)
        return JSONResponse(status_code=500,content={"detail":"Máy chủ gặp lỗi. Vui lòng thử lại."})


@app.exception_handler(RequestValidationError)
async def validation_error(request,exc):
    # Pydantic's default error response can echo passwords and full request inputs.
    return JSONResponse(status_code=422,content={"detail":"Dữ liệu yêu cầu không hợp lệ.",
        "errors":[{"loc":e["loc"],"msg":e["msg"]} for e in exc.errors()]})


@app.get("/health")
def health():
    with connection() as db:
        pending=db.execute("SELECT count(*) FROM telemetry_outbox WHERE delivered=0").fetchone()[0]
    return {"status":"online","telemetry_pending":pending,"telemetry_delivery":"at_least_once"}


for router in (security.router,catalog.router,interactions.router,jobs.router,crawler.router,telemetry.router,chat.router):
    app.include_router(router)
