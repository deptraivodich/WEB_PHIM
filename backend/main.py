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
import re
import urllib.request
import urllib.parse
import json
import httpx
try:
    import google.generativeai as genai
except ImportError:
    genai = None



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
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

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
        now_str
    ]

    async with buffer_lock:
        event_buffer.append(record)
        current_len = len(event_buffer)

    # If buffer reaches BATCH_SIZE, trigger immediate background flush
    if current_len >= BATCH_SIZE:
        background_tasks.add_task(flush_buffer)

    return {"status": "accepted", "buffered_count": current_len}

@app.get("/api/analytics/trending")
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


# -------------------------------------------------------------------
# Movie Crawler API Endpoint (PhimAPI -> TSV format for Magic Import)
# Hỗ trợ cào cả 1 Phim lẻ hoặc CẢ MỘT TRANG DANH SÁCH (Đa luồng Async)
# -------------------------------------------------------------------
class CrawlRequest(BaseModel):
    url: str

PHIM_API_SINGLE_BASE = os.getenv("PHIM_API_BASE_URL", "https://phimapi.com/phim")
PHIM_API_LIST_BASE = "https://phimapi.com/v1/api"
DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def classify_crawl_url(input_url: str):
    """
    Phân loại URL đầu vào thành ('single', slug) hoặc ('list', api_url)
    """
    raw_url = input_url.strip()
    parsed = urllib.parse.urlparse(raw_url)
    path = parsed.path.rstrip('/')
    query = parsed.query

    # 1. URL Phim lẻ: Có dạng /phim/slug (ví dụ: https://phimapi.com/phim/cuoc-chien-bang-dang)
    if '/phim/' in path:
        slug = path.split('/phim/')[-1].split('/')[0]
        return ('single', slug)

    # 2. Direct API List URL từ phimapi.com
    if 'phimapi.com/v1/api/' in raw_url:
        return ('list', raw_url)

    # 3. URL Web Danh sách (/danh-sach/..., /quoc-gia/..., /the-loai/...)
    if '/danh-sach/' in path:
        cat_slug = path.split('/danh-sach/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/danh-sach/{cat_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    if '/quoc-gia/' in path:
        country_slug = path.split('/quoc-gia/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/quoc-gia/{country_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    if '/the-loai/' in path:
        genre_slug = path.split('/the-loai/')[-1].split('/')[0]
        api_url = f"{PHIM_API_LIST_BASE}/the-loai/{genre_slug}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    # Fallback 1: Nếu là slug trực tiếp (không chứa slash hoặc query), coi là phim lẻ
    last_seg = path.split('/')[-1] if path else raw_url
    if last_seg and not query and 'danh-sach' not in last_seg and 'page=' not in raw_url:
        return ('single', last_seg)

    # Fallback 2: Nếu có query như ?page=2
    if last_seg:
        api_url = f"{PHIM_API_LIST_BASE}/danh-sach/{last_seg}"
        if query:
            api_url += f"?{query}"
        return ('list', api_url)

    return ('single', raw_url)


async def fetch_movie_detail(client: httpx.AsyncClient, slug: str) -> Optional[dict]:
    """
    Gọi API lấy chi tiết 1 phim bất đồng bộ. Bao bọc try/catch để 1 phim lỗi không làm chết cả list!
    """
    url = f"{PHIM_API_SINGLE_BASE.rstrip('/')}/{slug}"
    try:
        res = await client.get(url, timeout=12.0)
        if res.status_code == 200:
            data = res.json()
            if data and data.get('status'):
                return data
    except Exception as e:
        logger.warning(f"⚠️ Lỗi khi cào phim '{slug}': {e}")
    return None


def convert_movie_data_to_tsv_rows(data: dict) -> List[str]:
    """
    Format dữ liệu JSON của 1 bộ phim thành các dòng dữ liệu TSV (không bao gồm Header).
    Cột Thể Loại luôn để trống cho mọi dòng.
    """
    if not data or not data.get('status'):
        return []

    movie = data.get('movie', {})
    title = movie.get('name', '')
    original_title = movie.get('origin_name', '')
    year = str(movie.get('year', '2026'))

    # Xử lý Ảnh bìa (Ưu tiên poster_url - ảnh dọc, fallback về thumb_url - ảnh ngang)
    poster_url = movie.get('poster_url', '') or movie.get('thumb_url', '')
    if poster_url and not poster_url.startswith('http'): #ảnh poster
        poster_url = f"https://phimimg.com/{poster_url}"

    # Xử lý điểm IMDb / TMDB
    imdb_data = movie.get('imdb', {}) or {}
    tmdb_data = movie.get('tmdb', {}) or {}
    raw_score = imdb_data.get('vote_average') or tmdb_data.get('vote_average')
    imdb = f"{raw_score} /10" if raw_score else ""

    episodes_data = data.get('episodes', [])
    if not episodes_data:
        return []

    server_data = episodes_data[0].get('server_data', [])
    if not server_data:
        return []

    rows = []
    for index, ep in enumerate(server_data):
        raw_ep_name = ep.get('name', str(index + 1))
        ep_url = ep.get('link_m3u8', '') or ep.get('link_embed', '')

        # Chuẩn hóa số tập (bỏ chữ hoặc số 0 thừa nếu có)
        match = re.search(r'\d+', str(raw_ep_name))
        if match:
            ep_num = str(int(match.group()))
        else:
            ep_num = str(raw_ep_name)

        # Dòng 1 (Tập 1): Full metadata, Cột Thể Loại luôn để trống
        if index == 0:
            row = [title, original_title, ep_num, ep_url, poster_url, imdb, year, ""]
        else:
            # Các tập sau: Bỏ trống metadata, Cột Thể Loại cũng để trống
            row = ["", "", ep_num, ep_url, "", "", "", ""]

        rows.append("\t".join(row))

    return rows


@app.post("/api/crawl")
@app.get("/api/crawl")
async def crawl_movie_api(request: Optional[CrawlRequest] = None, url: Optional[str] = None):
    """
    API Cào dữ liệu Phim Đa Luồng (Bất đồng bộ asyncio.gather / httpx):
    - Nhận vào URL Phim lẻ HOẶC URL Cả Trang Danh Sách.
    - Xuất ra chuỗi TSV duy nhất nối dữ liệu của TẤT CẢ các phim cào được.
    """
    target_url = (request.url if request else url) or ""
    target_url = target_url.strip()

    if not target_url:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp URL hoặc Slug phim/trang danh sách!")

    url_type, param = classify_crawl_url(target_url)
    logger.info(f"🌐 Crawl Request - Phân loại URL: [{url_type}] | Param: {param}")

    headers = {"User-Agent": DEFAULT_USER_AGENT}

    async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
        slugs_to_crawl = []

        if url_type == 'single':
            slugs_to_crawl = [param]
        else:
            # Gọi API danh sách của PhimAPI để lấy danh sách slug
            try:
                list_res = await client.get(param)
                if list_res.status_code != 200:
                    raise HTTPException(status_code=400, detail=f"Không thể tải trang danh sách API (HTTP {list_res.status_code})!")
                
                list_data = list_res.json()
                items = list_data.get('data', {}).get('items', []) or list_data.get('items', [])
                if not items:
                    raise HTTPException(status_code=404, detail="Không tìm thấy phim nào trong trang danh sách này!")
                
                slugs_to_crawl = [item.get('slug') for item in items if item and item.get('slug')]
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"❌ Lỗi khi tải API trang danh sách: {e}")
                raise HTTPException(status_code=500, detail=f"Lỗi khi đọc danh sách phim: {str(e)}")

        if not slugs_to_crawl:
            raise HTTPException(status_code=404, detail="Danh sách slug phim rỗng!")

        logger.info(f"⚡ Bắt đầu cào ĐA LUỒNG đồng thời cho {len(slugs_to_crawl)} phim...")

        # ĐA LUỒNG CONCURRENT FETCH VỚI asyncio.gather
        movie_results = await asyncio.gather(*[fetch_movie_detail(client, slug) for slug in slugs_to_crawl])

        # Lọc ra các phim cào thành công
        successful_movies = [m for m in movie_results if m is not None]
        if not successful_movies:
            raise HTTPException(status_code=404, detail="Tất cả các phim trong danh sách đều không cào được dữ liệu!")

        # Chuẩn bị Header TSV
        tsv_headers = ["Tên Phim", "Tên Gốc", "Tập", "Link Video", "Ảnh bìa", "Điểm IMDb", "Năm", "Thể Loại"]
        all_tsv_lines = ["\t".join(tsv_headers)]

        for m_data in successful_movies:
            m_rows = convert_movie_data_to_tsv_rows(m_data)
            all_tsv_lines.extend(m_rows)

        final_tsv = "\n".join(all_tsv_lines)

        return {
            "status": True,
            "message": f"Cào thành công {len(successful_movies)}/{len(slugs_to_crawl)} bộ phim!",
            "crawled_count": len(successful_movies),
            "total_requested": len(slugs_to_crawl),
            "tsv": final_tsv
        }


# -------------------------------------------------------------------
# CineSmart AI Assistant Endpoint (Gemini-1.5-Flash + ClickHouse OLAP)
# -------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = "anonymous"
    available_movies: Optional[List[str]] = []

@app.post("/api/chat")
async def cine_smart_ai_chat(payload: ChatRequest):
    """
    Endpoint xử lý trò chuyện thông minh với CineSmart AI.
    Tích hợp dữ liệu thời gian thực Top 10 Trending từ ClickHouse vào System Prompt của Gemini API.
    """
    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Tin nhắn không được để trống!")

    # 1. Lấy danh sách Top 10 Trending từ ClickHouse theo thời gian thực
    trending_movies = []
    global clickhouse_client
    if not clickhouse_client:
        clickhouse_client = get_clickhouse_client()

    if clickhouse_client:
        try:
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
                LIMIT 10
            """
            result = clickhouse_client.query(query)
            for row in result.result_rows:
                trending_movies.append({
                    "movie_id": str(row[0]),
                    "play_count": int(row[1]),
                    "trending_score": round(float(row[4]), 1)
                })
        except Exception as e:
            logger.warning(f"Không thể truy vấn ClickHouse trending for AI context: {e}")

    # Danh sách dự phòng nếu ClickHouse chưa có đủ dữ liệu telemetry
    if not trending_movies:
        trending_movies = [
            {"movie_id": "Demon Slayer: Hashira Training Arc", "trending_score": 95.0},
            {"movie_id": "Thất Nghiệp Chuyển Sinh Phần 3", "trending_score": 92.3},
            {"movie_id": "Solo Leveling", "trending_score": 89.1},
            {"movie_id": "Jujutsu Kaisen Season 2", "trending_score": 87.4}
        ]

    trending_context = ", ".join([f"'{m['movie_id']}' (Điểm HOT: {m['trending_score']})" for m in trending_movies])

    # 2. Lấy danh sách tất cả các phim ĐANG CÓ THỰC TẾ trên hệ thống Web
    real_movies_list = payload.available_movies or [m['movie_id'] for m in trending_movies]
    real_movies_str = ", ".join([f"'{title}'" for title in real_movies_list[:35]])

    # 3. Lấy phim mà người dùng xem nhiều nhất từ dữ liệu ClickHouse Telemetry
    most_watched_movie = None
    if clickhouse_client:
        try:
            if payload.user_id and payload.user_id != 'anonymous':
                user_fav_query = """
                    SELECT movie_id, sum(watch_time) AS total_seconds
                    FROM web_phim.user_telemetry_events
                    WHERE user_id = {user_id:String} AND movie_id != ''
                    GROUP BY movie_id
                    ORDER BY total_seconds DESC
                    LIMIT 1
                """
                user_fav_res = clickhouse_client.query(user_fav_query, parameters={"user_id": payload.user_id})
                if user_fav_res.result_rows:
                    most_watched_movie = str(user_fav_res.result_rows[0][0])

            if not most_watched_movie:
                top_fav_query = """
                    SELECT movie_id, sum(watch_time) AS total_seconds
                    FROM web_phim.user_telemetry_events
                    WHERE movie_id != ''
                    GROUP BY movie_id
                    ORDER BY total_seconds DESC
                    LIMIT 1
                """
                top_fav_res = clickhouse_client.query(top_fav_query)
                if top_fav_res.result_rows:
                    most_watched_movie = str(top_fav_res.result_rows[0][0])
        except Exception as e:
            logger.warning(f"Không thể truy vấn phim xem nhiều nhất từ ClickHouse: {e}")

    if not most_watched_movie:
        most_watched_movie = real_movies_list[0] if real_movies_list else "Thất Nghiệp Chuyển Sinh Phần 3"

    # 4. Xây dựng System Prompt chống BỊP / CHỈ GỢI Ý PHIM CÓ TRONG KHO DỮ LIỆU THỰC TẾ
    system_prompt = (
        "Bạn là 'Trợ lý CineSmart AI', một chuyên gia điện ảnh & anime thông minh, sành sỏi của nền tảng 210LoliPhim. "
        f"QUY TẮC BẮT BUỘC SỐ 1 - KHO PHIM THỰC TẾ ĐANG CÓ TRÊN TRANG WEB GỒM: [{real_movies_str}]. "
        "⚠️ BẮT BUỘC CHỈ ĐƯỢC GIỚI THIỆU VÀ GỢI Ý CÁC PHIM CÓ NẰM TRONG KHO PHIM THỰC TẾ Ở TRÊN! "
        "TUYỆT ĐỐI KHÔNG TỰ BỊA HOẶC NÊU CÁC BỘ PHIM NGOÀI DANH SÁCH NÀY KHỎI BỊ NGƯỜI DÙNG BẮT BỎ HÃNG/BỊP! "
        f"Dữ liệu thời gian thực từ ClickHouse ghi nhận phim người dùng xem nhiều nhất là: '{most_watched_movie}'. "
        f"KHI NGƯỜI DÙNG HỎI 'Phim hợp gu tôi' HOẶC XIN GỢI Ý PHIM HỢP GU: Hãy phân tích thể loại/phong cách của phim '{most_watched_movie}' "
        f"và chọn ra 2-3 bộ phim TRONG KHO PHIM THỰC TẾ NÀY [{real_movies_str}] có cùng thể loại hoặc hợp gu nhất để giới thiệu một cách hào hứng, giải thích vì sao hợp gu! "
        "Hãy luôn trả lời ngắn gọn, súc tích, hài hước, dùng định dạng Markdown (in đậm, danh sách bullet...) và icon cảm xúc sinh động."
    )



    # 3. Gửi System Prompt + Tin nhắn tới Gemini (gemini-1.5-flash)
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    if not gemini_key or genai is None:
        logger.warning("GEMINI_API_KEY chưa được thiết lập hoặc thư viện google-generativeai chưa có.")
        # Phản hồi dự phòng thông minh khi chưa có API Key
        fallback_reply = (
            f"🎬 **Trợ lý CineSmart AI** (Chế độ offline):\n"
            f"Dưới đây là các phim đang **HOT nhất** trên hệ thống theo thống kê ClickHouse thời gian thực:\n"
            + "\n".join([f"• **{m['movie_id']}** (Độ HOT: {m['trending_score']})" for m in trending_movies[:5]])
            + "\n\n*(Lưu ý: Hãy thiết lập `GEMINI_API_KEY` trong môi trường Docker để kích hoạt mô hình Gemini 1.5 Flash đầy đủ!)*"
        )
        return {
            "status": True,
            "reply": fallback_reply,
            "trending_used": trending_movies
        }

    try:
        genai.configure(api_key=gemini_key)
        full_prompt = f"{system_prompt}\n\nNgười dùng nhắn: {user_message}\nCineSmart AI trả lời:"
        
        candidate_models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-1.5-flash", "gemini-2.5-pro", "gemini-pro-latest"]

        reply_text = None
        last_error = None

        for model_name in candidate_models:
            try:
                model = genai.GenerativeModel(model_name)
                res = model.generate_content(full_prompt)
                if res and hasattr(res, 'text') and res.text:
                    reply_text = res.text
                    break
            except Exception as e:
                last_error = e
                continue

        if not reply_text:
            if last_error:
                raise last_error
            reply_text = "Xin lỗi, tôi chưa thể xử lý phản hồi từ Gemini lúc này."

        return {
            "status": True,
            "reply": reply_text,
            "trending_used": trending_movies
        }

    except Exception as err:
        logger.error(f"Lỗi khi gọi Gemini 1.5 Flash API: {err}")
        return {
            "status": True,
            "reply": f"🤖 **Trợ lý CineSmart AI**: Rất tiếc có sự cố kết nối với Gemini API ({str(err)}). "
                     f"Tuy nhiên tôi gợi ý bạn trải nghiệm ngay bộ phim **{trending_movies[0]['movie_id']}** đang làm mưa làm gió!",
            "error": str(err)
        }


