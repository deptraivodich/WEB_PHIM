"""Local operator commands; passwords are read with getpass, never argv or logs."""
import argparse
import getpass
import re
import uuid
from .db import migrate, connection
from .security import hash_password


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate", "create-admin", "reset-password", "audit"])
    parser.add_argument("--username")
    args = parser.parse_args()
    migrate()
    if args.command == "migrate":
        print("Migration complete.")
        return
    if args.command == "audit":
        with connection() as db:
            for table in ("user_movie_likes", "movie_comments"):
                count = db.execute(f"SELECT count(*) FROM {table} WHERE user_id NOT IN (SELECT id FROM users)").fetchone()[0]
                print(f"{table}: unresolved legacy user references = {count}")
        return
    name = (args.username or input("Username: ")).strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,64}", name):
        raise SystemExit("Invalid username")
    password = getpass.getpass("New password (12-128 characters): ")
    if not 12 <= len(password) <= 128 or password != getpass.getpass("Confirm password: "):
        raise SystemExit("Password requirements or confirmation failed")
    hashed = hash_password(password)
    with connection() as db:
        if args.command == "create-admin":
            if db.execute("SELECT 1 FROM users WHERE role='admin' AND password_reset_required=0").fetchone():
                raise SystemExit("An active admin already exists. Use reset-password for an existing account.")
            if db.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
                raise SystemExit("Account exists. Use reset-password; role is preserved.")
            db.execute("INSERT INTO users(id,username,password_hash,role,display_name) VALUES(?,?,?,'admin',?)",
                       (str(uuid.uuid4()), name, hashed, name))
        else:
            row = db.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()
            if not row:
                raise SystemExit("Account not found")
            db.execute("UPDATE users SET password_hash=?,password_reset_required=0 WHERE id=?", (hashed, row["id"]))
            db.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
    print("Account updated.")


if __name__ == "__main__":
    main()
