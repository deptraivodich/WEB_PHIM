import os
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import clickhouse_connect

# Logging setup
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("telemetry_ingestion")

# Configuration from Environment
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "web_phim")
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "default_password")

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))
FLUSH_INTERVAL_SECONDS = int(os.getenv("FLUSH_INTERVAL_SECONDS", "5"))

# Global State
clickhouse_client = None
event_buffer: List[list] = []
buffer_lock = asyncio.Lock()

def get_clickhouse_client():
    """Establish connection to ClickHouse with retries."""
    try:
        client = clickhouse_connect.get_client(
            host=CLICKHOUSE_HOST,
            port=CLICKHOUSE_PORT,
            username=CLICKHOUSE_USER,
            password=CLICKHOUSE_PASSWORD,
            database=CLICKHOUSE_DB
        )
        logger.info("Successfully connected to ClickHouse server")
        return client
    except Exception as e:
        logger.error(f"Failed to connect to ClickHouse at {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}: {e}")
        return None

async def flush_buffer():
    """Flush in-memory event buffer to ClickHouse in a single batch insert."""
    global event_buffer, clickhouse_client
    async with buffer_lock:
        if not event_buffer:
            return
        events_to_insert = event_buffer.copy()
        event_buffer.clear()

    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()

    if clickhouse_client:
        try:
            column_names = [
                'user_id', 'session_id', 'movie_id', 'action_type', 
                'watch_time', 'video_quality', 'device_type', 'ip_address', 'created_at'
            ]
            clickhouse_client.insert(
                table='user_telemetry_events',
                data=events_to_insert,
                column_names=column_names
            )
            logger.info(f"Successfully bulk inserted {len(events_to_insert)} telemetry events to ClickHouse.")
        except Exception as e:
            logger.error(f"Error bulk inserting events to ClickHouse: {e}")
            # Re-queue on failure to prevent data loss
            async with buffer_lock:
                event_buffer.extend(events_to_insert)
    else:
        logger.warning(f"ClickHouse client unavailable. Re-queueing {len(events_to_insert)} events.")
        async with buffer_lock:
            event_buffer.extend(events_to_insert)

async def periodic_flush():
    """Background task to flush buffer periodically."""
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
        await flush_buffer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global clickhouse_client
    clickhouse_client = get_clickhouse_client()
    # Start periodic flush task
    flush_task = asyncio.create_task(periodic_flush())
    yield
    # Cleanup: Flush remaining events on shutdown
    flush_task.cancel()
    await flush_buffer()
    if clickhouse_client:
        clickhouse_client.close()

app = FastAPI(
    title="210LoliPhim Big Data Ingestion API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Event Schema Definition
ALLOWED_ACTIONS = {'click_poster', 'view_detail', 'play', 'pause', 'seek', 'heartbeat', 'search', 'complete'}

class TelemetryEvent(BaseModel):
    user_id: str = Field(default="anonymous", description="User ID or device token")
    session_id: str = Field(default="", description="Unique session ID")
    movie_id: str = Field(..., description="ID of the movie being interacted with")
    action_type: str = Field(..., description="Action type: play, pause, seek, heartbeat, view_detail, click_poster, search, complete")
    watch_time: int = Field(default=0, description="Duration watched in seconds")
    video_quality: str = Field(default="", description="Video quality e.g. 1080p, 4K")
    device_type: str = Field(default="web", description="Device type e.g. web, mobile, tv")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Client event timestamp")

@app.get("/health")
def health_check():
    ch_status = "connected" if (clickhouse_client and clickhouse_client.ping()) else "disconnected"
    return {
        "status": "online",
        "clickhouse": ch_status,
        "buffered_events_count": len(event_buffer)
    }

@app.post("/api/track")
async def track_event(event: TelemetryEvent, request: Request, background_tasks: BackgroundTasks):
    """
    Ingest user interaction telemetry event into high-performance buffer.
    """
    if event.action_type not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid action_type. Must be one of {ALLOWED_ACTIONS}")

    client_ip = request.client.host if request.client else ""

    # Remove timezone info to avoid ClickHouse DateTime type mismatch (assumes UTC)
    dt_naive = event.timestamp.replace(tzinfo=None) if event.timestamp.tzinfo else event.timestamp

    # Format record matching ClickHouse schema
    record = [
        event.user_id,
        event.session_id,
        event.movie_id,
        event.action_type,
        event.watch_time,
        event.video_quality,
        event.device_type,
        client_ip,
        dt_naive
    ]

    async with buffer_lock:
        event_buffer.append(record)
        current_len = len(event_buffer)

    # If buffer reaches BATCH_SIZE, trigger immediate background flush
    if current_len >= BATCH_SIZE:
        background_tasks.add_task(flush_buffer)

    return {"status": "accepted", "buffered_count": current_len}

@app.get("/api/trending")
def get_trending_movies(limit: int = 10):
    """
    Demonstration OLAP Query: Aggregate real-time trending movies from ClickHouse.
    """
    global clickhouse_client
    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()
    
    if not clickhouse_client:
        raise HTTPException(status_code=503, detail="ClickHouse service unavailable")

    query = """
        SELECT 
            movie_id,
            countIf(action_type = 'play') AS play_count,
            countIf(action_type = 'view_detail') AS detail_views,
            sum(watch_time) AS total_watch_seconds,
            (play_count * 5 + detail_views * 2 + total_watch_seconds / 60) AS score
        FROM web_phim.user_telemetry_events
        WHERE created_at >= now() - INTERVAL 7 DAY
        GROUP BY movie_id
        ORDER BY score DESC
        LIMIT {limit:UInt32}
    """
    try:
        result = clickhouse_client.query(query, parameters={"limit": limit})
        return {
            "timeframe": "7_days",
            "trending": [
                {
                    "movie_id": row[0],
                    "play_count": row[1],
                    "detail_views": row[2],
                    "total_watch_seconds": row[3],
                    "trending_score": round(row[4], 2)
                }
                for row in result.result_rows
            ]
        }
    except Exception as e:
        logger.error(f"Error querying trending analytics: {e}")
        return {"error": str(e), "trending": []}
