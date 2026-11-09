"""Organizer authentication — email/password with bcrypt, JWT sessions."""

from __future__ import annotations

import datetime
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Optional

import bcrypt
import jwt

_DB_PATH = Path(os.getenv("SPOTLITE_DATA_DIR", "data")) / "auth.db"
_JWT_SECRET = os.getenv("SPOTLITE_JWT_SECRET", secrets.token_hex(32))
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_HOURS = int(os.getenv("SPOTLITE_JWT_EXPIRY_HOURS", "72"))


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(_DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS organizers (
                id        TEXT PRIMARY KEY,
                email     TEXT UNIQUE NOT NULL,
                name      TEXT NOT NULL,
                pw_hash   TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        c.commit()


def register(email: str, name: str, password: str) -> dict:
    email = email.strip().lower()
    if not email or not password or not name:
        raise ValueError("email, name, and password are required")
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    org_id = secrets.token_hex(12)
    created_at = datetime.datetime.utcnow().isoformat()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO organizers(id, email, name, pw_hash, created_at) VALUES (?,?,?,?,?)",
                (org_id, email, name, pw_hash, created_at),
            )
            c.commit()
    except sqlite3.IntegrityError:
        raise ValueError("Email already registered")
    return {"id": org_id, "email": email, "name": name}


def login(email: str, password: str) -> Optional[str]:
    email = email.strip().lower()
    with _conn() as c:
        row = c.execute("SELECT * FROM organizers WHERE email = ?", (email,)).fetchone()
    if not row:
        return None
    if not bcrypt.checkpw(password.encode(), row["pw_hash"].encode()):
        return None
    payload = {
        "sub": row["id"],
        "email": row["email"],
        "name": row["name"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def get_organizer(org_id: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute("SELECT id, email, name, created_at FROM organizers WHERE id = ?", (org_id,)).fetchone()
    return dict(row) if row else None


def update_password(org_id: str, new_password: str) -> bool:
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    with _conn() as c:
        c.execute("UPDATE organizers SET pw_hash = ? WHERE id = ?", (pw_hash, org_id))
        c.commit()
    return True
