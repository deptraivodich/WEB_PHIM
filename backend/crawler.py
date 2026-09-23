import asyncio
import csv
import io
import json
from pathlib import Path
import re
import unicodedata
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from . import catalog, jobs
from .safe_http import classify_crawl_url, get_json, SLUG
from .security import require_admin

def normalize_slug_str(text: str) -> str:
    if not text:
        return ''
    s = str(text).replace('đ', 'd').replace('Đ', 'd')
    s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')
    s = re.sub(r'[^\w\s-]', '', s.lower())
    return re.sub(r'[-\s]+', '-', s).strip('-')

def is_eligible_for_auto_crawl(movie: dict) -> bool:
    """
    Điều kiện lọc Nhiệm vụ 2:
    - Phim trong DB đang ở trạng thái CHƯA Completed (không phải Hoàn Tất chính thức).
    - VÀ KHÔNG PHẢI là phim lẻ chiếu rạp (bỏ qua phim chỉ có 1 tập thời lượng dài, hoặc thể loại Movie/Chiếu rạp).
    """
    status = str(movie.get('status', '') or '').lower().strip()

    # Bỏ qua phim đã hoàn tất chính thức
    if status in ['completed', 'hoàn tất', 'hoan tat']:
        return False

    # Bỏ qua phim lẻ chiếu rạp
    cat = str(movie.get('category', '') or '').lower()
    badge = str(movie.get('badge', '') or '').lower()
    genres = movie.get('genres', [])
    genres_str = (" ".join(genres) if isinstance(genres, list) else str(genres)).lower()
    movie_type = str(movie.get('type', '') or '').lower()
    chieurap = movie.get('chieurap')

    if chieurap is True or movie_type == 'single':
        return False
    if 'chiếu rạp' in cat or 'phim lẻ' in cat or 'movie' in cat:
        return False
    if 'chiếu rạp' in genres_str or 'phim lẻ' in genres_str:
        return False
    if 'rạp' in badge or 'chiếu rạp' in badge:
        return False

    # Nếu chỉ có 1 tập dạng full/trọn bộ
    episodes = movie.get('episodes', [])
    if isinstance(episodes, list) and len(episodes) == 1:
        ep_name = str(episodes[0].get('name', '')).strip().lower()
        if ep_name in ['full', 'trọn bộ', 'tron bo']:
            return False

    return True

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

    # Xử lý Quốc Gia
    country_data = movie.get('country', [])
    if isinstance(country_data, list):
        country_str = ", ".join([c.get('name', '') for c in country_data if isinstance(c, dict) and c.get('name')])
    elif isinstance(country_data, dict):
        country_str = country_data.get('name', '')
    else:
        country_str = str(country_data or '')

    # Xử lý Đạo Diễn
    director_data = movie.get('director', [])
    if isinstance(director_data, list):
        director_str = ", ".join([str(d.get('name') if isinstance(d, dict) else d) for d in director_data if d])
    elif isinstance(director_data, dict):
        director_str = director_data.get('name', '')
    else:
        director_str = str(director_data or '')

    # Xử lý Thông Tin (Status, vd: completed, ongoing) & Tập hiện tại (vd: Hoàn Tất (12/12), Tập 5)
    status_str = str(movie.get('status', '') or '').strip()
    episode_current_str = str(movie.get('episode_current', '') or '').strip()

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

        # Dòng 1 (Tập 1): Full metadata theo thứ tự 12 cột bắt buộc:
        # Tên Phim | Tên Gốc | Tập | Link Video | Ảnh bìa | Điểm IMDb | Năm | Quốc Gia | Đạo Diễn | Thông Tin | Tập hiện tại | Thể Loại
        if index == 0:
            row = [title, original_title, ep_num, ep_url, poster_url, imdb, year, country_str, director_str, status_str, episode_current_str, ""]
        else:
            # Các tập sau: Bỏ trống metadata (12 cột)
            row = ["", "", ep_num, ep_url, "", "", "", "", "", "", "", ""]

        buffer = io.StringIO()
        csv.writer(buffer, delimiter="\t", lineterminator="\n").writerow(row)
        rows.append(buffer.getvalue().rstrip("\n"))

    return rows




router=APIRouter()
TSV_HEADERS=json.loads(Path(__file__).with_name('tsv_schema.json').read_text(encoding='utf-8'))


class CrawlRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    url:str=Field(min_length=1,max_length=2048)


@router.post("/api/crawl")
async def crawl(payload:CrawlRequest,user=Depends(require_admin)):
    owner=await asyncio.to_thread(jobs.claim,"crawler",120)
    if not owner:
        raise HTTPException(409,"Một tác vụ crawler đang chạy.")
    try:
        kind,value=classify_crawl_url(payload.url)
        if kind=="single":
            slugs=[value]
        else:
            data=await get_json(value)
            items=data.get("data",{}).get("items",[]) or data.get("items",[])
            slugs=list(dict.fromkeys(item.get("slug") for item in items if isinstance(item,dict) and item.get("slug")))[:20]
        if not slugs:
            raise HTTPException(404,"Nguồn không có phim.")
        semaphore=asyncio.Semaphore(4)
        async def fetch(slug):
            async with semaphore:
                if not isinstance(slug,str) or not SLUG.fullmatch(slug):
                    return None
                try:
                    return await get_json("https://phimapi.com/phim/"+slug)
                except HTTPException:
                    return None
        results=await asyncio.wait_for(asyncio.gather(*(fetch(s) for s in slugs)),timeout=100)
        successful=[r for r in results if r and r.get("status") and r.get("movie")]
        if not successful:
            raise HTTPException(502,"Không lấy được phim từ nguồn.")
        lines=["\t".join(TSV_HEADERS)]
        for result in successful:
            lines.extend(convert_movie_data_to_tsv_rows(result))
        return {"status":True,"tsv":"\n".join(lines),"crawled_count":len(successful),
                "total_requested":len(slugs),"failed_count":len(slugs)-len(successful)}
    except asyncio.TimeoutError:
        raise HTTPException(504,"Crawler hết thời gian xử lý.")
    finally:
        await asyncio.to_thread(jobs.finish,"crawler",owner)


def merge_movie(movie,data):
    source=data.get("movie",{})
    def names(value):
        if isinstance(value,list):
            return ", ".join(str(v.get("name","") if isinstance(v,dict) else v) for v in value if v)
        return str(value.get("name","") if isinstance(value,dict) else value or "")
    old_eps=movie.get("episodes") or []
    def ep_key(name):
        match=re.search(r"\d+",str(name))
        return str(int(match[0])) if match else str(name).strip().casefold()
    merged={ep_key(e.get("name")):dict(e) for e in old_eps}
    api_eps=(data.get("episodes") or [{}])[0].get("server_data",[])
    for ep in api_eps:
        url=ep.get("link_m3u8") or ep.get("link_embed")
        if url:
            merged[ep_key(ep.get("name"))]={"name":str(ep.get("name")),"url":url}
    episodes=sorted(merged.values(),key=lambda ep:(0,int(ep_key(ep["name"]))) if ep_key(ep["name"]).isdigit() else (1,ep_key(ep["name"])))
    patch={"episodes":episodes,
           "country":names(source.get("country")) or movie.get("country",""),
           "director":names(source.get("director")) or movie.get("director",""),
           "status":source.get("status") or movie.get("status","ongoing"),
           "episodeCurrent":source.get("episode_current") or movie.get("episodeCurrent","")}
    changed=any(patch[k]!=movie.get(k) for k in patch)
    updated={**movie,**patch,"lastAutoCrawledAt":datetime.now(timezone.utc).isoformat()}
    if changed:
        updated.update(episodesCount=f"{len(episodes)} Tập",episodesStatus=patch["episodeCurrent"],
                       m3u8Url=episodes[0].get("url","") if episodes else movie.get("m3u8Url",""))
    return updated,changed,max(0,len(episodes)-len(old_eps))


async def run_auto_update(ids=None,due=False):
    owner=await asyncio.to_thread(jobs.claim,"auto-update",600,due)
    if not owner:
        if due:
            return None
        raise HTTPException(409,"Một tác vụ cập nhật đang chạy.")
    try:
        async with asyncio.timeout(480):
            movies=await asyncio.to_thread(catalog.all_movies)
            selected=[m for m in movies if is_eligible_for_auto_crawl(m) and (ids is None or m["id"] in ids)]
            selected.sort(key=lambda m:str(m.get("lastAutoCrawledAt") or ""))
            details=[]
            updates=[]
            for movie in selected[:20]:
                if not await asyncio.to_thread(jobs.owns,"auto-update",owner):
                    break
                try:
                    slug=movie.get("slug") or normalize_slug_str(movie.get("title",""))
                    if not SLUG.fullmatch(slug):
                        raise HTTPException(422,"Slug phim không hợp lệ.")
                    data=await get_json("https://phimapi.com/phim/"+slug)
                    if not data.get("status") or not data.get("movie"):
                        raise HTTPException(502,"Nguồn chưa có dữ liệu phim.")
                    updated,changed,added=merge_movie(movie,data)
                    saved=await asyncio.to_thread(jobs.guarded_write,owner,
                        lambda:catalog.save_movie(movie["id"],updated))
                    if changed:
                        updates.append(saved)
                    details.append({"id":movie["id"],"title":movie["title"],"status":"updated" if changed else "unchanged",
                                    "episodes_count":len(updated["episodes"]),"added_episodes_count":added})
                except HTTPException as exc:
                    details.append({"id":movie["id"],"title":movie["title"],"status":"error","message":exc.detail})
            report={"status":"success","checked_count":len(details),"updated_count":len(updates),
                    "updated_movies":updates,"checked_details":details}
            errors=sum(d["status"]=="error" for d in details)
            if errors:
                report["status"]="partial"
            await asyncio.to_thread(jobs.finish,"auto-update",owner,report,"Một số phim cập nhật thất bại." if errors else None)
            return report
    except BaseException:
        await asyncio.to_thread(jobs.finish,"auto-update",owner,None,"Tác vụ bị gián đoạn hoặc nguồn dữ liệu không khả dụng.")
        raise


class AutoUpdateRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    movie_ids:list[str] | None=Field(default=None,max_length=20)


@router.post("/api/movies/auto-update")
async def auto_update(payload:AutoUpdateRequest,user=Depends(require_admin)):
    return await run_auto_update(payload.movie_ids)
