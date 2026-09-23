"""Strict HTTPS allowlist, pinned public DNS addresses, no redirects, bounded responses."""
import asyncio
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, parse_qsl, urlencode
from fastapi import HTTPException

HOST = "phimapi.com"
MAX_BYTES = 4 * 1024 * 1024
_slots = threading.BoundedSemaphore(4)
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def classify_crawl_url(value):
    value = value.strip()
    if len(value) <= 200 and SLUG.fullmatch(value):
        return "single", value
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.hostname != HOST or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment:
            raise ValueError()
        path = parsed.path.rstrip("/")
        if re.fullmatch(r"/phim/[a-z0-9]+(?:-[a-z0-9]+)*", path) and not parsed.query:
            return "single", path.split("/")[-1]
        match = re.fullmatch(r"/(?:v1/api/)?(danh-sach|quoc-gia|the-loai)/([a-z0-9]+(?:-[a-z0-9]+)*)", path)
        if not match:
            raise ValueError()
        query = parse_qsl(parsed.query, keep_blank_values=True)
        if any(k not in {"page", "limit"} or not v.isdigit() or not 1 <= int(v) <= (20 if k == "limit" else 10000) for k,v in query):
            raise ValueError()
        return "list", f"https://{HOST}/v1/api/{match[1]}/{match[2]}" + ("?"+urlencode(query) if query else "")
    except ValueError:
        raise HTTPException(422, "Chỉ nhận slug hoặc URL HTTPS hợp lệ thuộc phimapi.com.")


def public_addresses(host):
    addresses = list(dict.fromkeys(info[4][0] for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise HTTPException(422, "Địa chỉ nguồn không được phép.")
    return addresses


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        addresses = public_addresses(self.host)
        # Connect to a numeric, validated address. TLS still verifies the original hostname.
        raw = socket.create_connection((addresses[0], 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def fetch_json(url):
    kind, value = classify_crawl_url(url)
    url = f"https://{HOST}/phim/{value}" if kind == "single" else value
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "Crawler đang bận.")
    conn = None
    try:
        parsed = urlsplit(url)
        conn = PinnedHTTPSConnection(HOST, timeout=12, context=ssl.create_default_context())
        started = time.monotonic()
        conn.request("GET", parsed.path + ("?"+parsed.query if parsed.query else ""), headers={"User-Agent": "WEB_PHIM/1.0", "Accept": "application/json", "Accept-Encoding": "identity"})
        response = conn.getresponse()
        if response.status != 200:
            # Redirects are deliberately rejected; never follow a Location header.
            raise HTTPException(502, "Nguồn phim từ chối yêu cầu hoặc chuyển hướng.")
        length = response.getheader("Content-Length")
        if length and int(length) > MAX_BYTES:
            raise HTTPException(502, "Phản hồi nguồn phim quá lớn.")
        chunks, total = [], 0
        while True:
            remaining = 15 - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError()
            if conn.sock:
                conn.sock.settimeout(min(remaining, 12))
            part = response.read(min(65536, MAX_BYTES+1-total))
            if not part:
                break
            total += len(part)
            if total > MAX_BYTES:
                raise HTTPException(502, "Phản hồi nguồn phim quá lớn.")
            chunks.append(part)
        return json.loads(b"".join(chunks))
    except HTTPException:
        raise
    except (TimeoutError, socket.timeout):
        raise HTTPException(504, "Nguồn phim phản hồi quá chậm.")
    except Exception:
        raise HTTPException(502, "Không đọc được dữ liệu nguồn phim.")
    finally:
        if conn:
            conn.close()
        _slots.release()


async def get_json(url):
    return await asyncio.to_thread(fetch_json, url)
