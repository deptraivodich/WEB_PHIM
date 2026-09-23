"""Environment-only configuration. Importing this module never opens a database."""
import os
from pathlib import Path

DB_PATH = Path(os.getenv("SQLITE_PATH", str(Path(__file__).with_name("interactions.db")))).resolve()
ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if x.strip()]
if "*" in ORIGINS:
    raise ValueError("CORS_ORIGINS must contain explicit origins")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()
if COOKIE_SAMESITE not in {"lax", "strict", "none"} or (COOKIE_SAMESITE == "none" and not COOKIE_SECURE):
    raise ValueError("Invalid cookie policy")
SESSION_SECONDS = max(300, min(int(os.getenv("SESSION_SECONDS", "28800")), 604800))
COOKIE_NAME = "webphim_session"
MAX_BODY_BYTES = 2 * 1024 * 1024
