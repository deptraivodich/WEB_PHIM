"""SQLite setup is explicit, backed up once before each migration, and import-safe."""
import sqlite3
import time
from contextlib import contextmanager
from . import config

@contextmanager
def connection():
    db = sqlite3.connect(str(config.DB_PATH), timeout=15)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()

def migrate():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    existed = config.DB_PATH.exists()
    with connection() as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version >= 1:
            return
        if existed:
            backup_path = str(config.DB_PATH) + ".pre-v1-" + str(time.time_ns()) + ".bak"
            backup = sqlite3.connect(backup_path)
            try:
                db.backup(backup)
            finally:
                backup.close()
        db.executescript(BASE_SQL)
        db.execute("BEGIN IMMEDIATE")
        if "password_reset_required" not in {r[1] for r in db.execute("PRAGMA table_info(users)")}:
            db.execute("ALTER TABLE users ADD COLUMN password_reset_required INTEGER NOT NULL DEFAULT 0")
        for pw_hash in DEFAULT_PASSWORD_HASHES:
            db.execute("UPDATE users SET password_reset_required=1 WHERE password_hash=?", (pw_hash,))
        for sql in EXTRA_SQL:
            db.execute(sql)
        # The old frontend sent usernames, but accounts already have immutable UUIDs.
        for user in db.execute("SELECT id, username FROM users").fetchall():
            if user["id"] != user["username"]:
                db.execute("""INSERT OR IGNORE INTO user_movie_likes(user_id,movie_id,created_at)
                    SELECT ?,movie_id,created_at FROM user_movie_likes WHERE user_id=?""", (user["id"],user["username"]))
                db.execute("DELETE FROM user_movie_likes WHERE user_id=?", (user["username"],))
                db.execute("UPDATE movie_comments SET user_id=? WHERE user_id=?", (user["id"],user["username"]))
        db.execute("PRAGMA user_version=1")

EXTRA_SQL = [
    "CREATE TABLE IF NOT EXISTS telemetry_outbox(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,received REAL NOT NULL,delivered INTEGER DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS telemetry_pending ON telemetry_outbox(delivered,received)",
    "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf_hash TEXT NOT NULL,expires REAL NOT NULL)",
    "CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)",
    "CREATE TABLE IF NOT EXISTS rate_limits(key TEXT,bucket INTEGER,count INTEGER NOT NULL,expires INTEGER,PRIMARY KEY(key,bucket))",
    "CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires)",
    "CREATE TABLE IF NOT EXISTS view_receipts(actor TEXT,movie_id TEXT,bucket INTEGER,PRIMARY KEY(actor,movie_id,bucket))",
    "CREATE INDEX IF NOT EXISTS view_logs_time_movie ON view_logs(created_at,movie_id)",
    "CREATE INDEX IF NOT EXISTS comments_movie_time ON movie_comments(movie_id,created_at)",
    "CREATE INDEX IF NOT EXISTS likes_movie ON user_movie_likes(movie_id)",
    "CREATE TABLE IF NOT EXISTS jobs(name TEXT PRIMARY KEY,owner TEXT,lease_until REAL DEFAULT 0,interval_seconds INTEGER DEFAULT 0,next_run REAL DEFAULT 0,last_started REAL,last_finished REAL,status TEXT DEFAULT 'idle',error TEXT,report TEXT)",
    "CREATE TABLE IF NOT EXISTS chat_history(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,role TEXT,content TEXT,created_at REAL)",
    "CREATE INDEX IF NOT EXISTS chat_user_time ON chat_history(user_id,id)",
]

BASE_SQL = "CREATE TABLE IF NOT EXISTS movie_views (\n            movie_id TEXT PRIMARY KEY,\n            views INTEGER DEFAULT 0,\n            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n        );\nCREATE TABLE IF NOT EXISTS user_movie_likes (\n            user_id TEXT,\n            movie_id TEXT,\n            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n            PRIMARY KEY (user_id, movie_id)\n        );\nCREATE TABLE IF NOT EXISTS movie_comments (\n            id TEXT PRIMARY KEY,\n            movie_id TEXT,\n            user_id TEXT,\n            username TEXT,\n            avatar TEXT,\n            content TEXT,\n            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n        );\nCREATE TABLE IF NOT EXISTS movies (\n            id TEXT PRIMARY KEY,\n            title TEXT,\n            original_title TEXT,\n            status TEXT DEFAULT 'ongoing',\n            episode_current TEXT DEFAULT '',\n            director TEXT DEFAULT '',\n            country TEXT DEFAULT '',\n            year TEXT DEFAULT '',\n            imdb TEXT DEFAULT '',\n            poster TEXT DEFAULT '',\n            banner TEXT DEFAULT '',\n            episodes_count TEXT DEFAULT '',\n            episodes TEXT DEFAULT '[]',\n            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n        );\nCREATE TABLE IF NOT EXISTS view_logs (\n            id INTEGER PRIMARY KEY AUTOINCREMENT,\n            movie_id TEXT,\n            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n        );\nCREATE TABLE IF NOT EXISTS users (\n            id TEXT PRIMARY KEY,\n            username TEXT UNIQUE NOT NULL,\n            password_hash TEXT NOT NULL,\n            role TEXT DEFAULT 'user',\n            age INTEGER DEFAULT 18,\n            display_name TEXT DEFAULT '',\n            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n        );"
DEFAULT_PASSWORD_HASHES = ['240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', '084473d96659b25d33be2781b15c23ac2e9e2351c1a6f402865bc2b69323247a']
