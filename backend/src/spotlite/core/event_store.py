"""Event store: events, panelists, attendee tokens, saved contacts."""

from __future__ import annotations

import datetime
import os
import random
import secrets
import sqlite3
import string
from pathlib import Path
from typing import Optional

_DB_PATH = Path(os.getenv("SPOTLITE_DATA_DIR", "data")) / "events.db"
_CODE_CHARS = string.ascii_uppercase + string.digits
_CODE_LENGTH = 10


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(_DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT,
                organizer_id TEXT NOT NULL,
                organizer_name TEXT,
                date         TEXT,
                location     TEXT,
                created_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS panelists (
                id             TEXT PRIMARY KEY,
                event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                name           TEXT NOT NULL,
                title          TEXT,
                company        TEXT,
                bio            TEXT,
                linkedin_url   TEXT,
                image_path     TEXT,
                face_encoded   INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attendee_tokens (
                id             TEXT PRIMARY KEY,
                event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                code           TEXT UNIQUE NOT NULL,
                attendee_name  TEXT,
                attendee_email TEXT,
                used_at        TEXT,
                created_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS saved_contacts (
                id             TEXT PRIMARY KEY,
                attendee_code  TEXT NOT NULL,
                event_id       TEXT NOT NULL,
                panelist_id    TEXT,
                panelist_name  TEXT NOT NULL,
                saved_at       TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_panelists_event   ON panelists(event_id);
            CREATE INDEX IF NOT EXISTS idx_tokens_event      ON attendee_tokens(event_id);
            CREATE INDEX IF NOT EXISTS idx_tokens_code       ON attendee_tokens(code);
            CREATE INDEX IF NOT EXISTS idx_contacts_code     ON saved_contacts(attendee_code);
        """)
        c.commit()


# ── Events ──────────────────────────────────────────────────────────────────

def create_event(
    name: str,
    organizer_id: str,
    organizer_name: str = "",
    description: str = "",
    date: str = "",
    location: str = "",
) -> dict:
    event_id = secrets.token_hex(10)
    created_at = datetime.datetime.utcnow().isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO events(id,name,description,organizer_id,organizer_name,date,location,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (event_id, name, description, organizer_id, organizer_name, date, location, created_at),
        )
        c.commit()
    return get_event(event_id)


def get_event(event_id: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    return dict(row) if row else None


def list_events(organizer_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM events WHERE organizer_id = ? ORDER BY created_at DESC", (organizer_id,)).fetchall()
    return [dict(r) for r in rows]


def delete_event(event_id: str, organizer_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM events WHERE id = ? AND organizer_id = ?", (event_id, organizer_id))
        c.commit()
    return cur.rowcount > 0


def update_event(event_id: str, organizer_id: str, **fields) -> Optional[dict]:
    allowed = {"name", "description", "date", "location"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return get_event(event_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with _conn() as c:
        c.execute(
            f"UPDATE events SET {set_clause} WHERE id = ? AND organizer_id = ?",
            (*updates.values(), event_id, organizer_id),
        )
        c.commit()
    return get_event(event_id)


# ── Panelists ────────────────────────────────────────────────────────────────

def add_panelist(
    event_id: str,
    name: str,
    title: str = "",
    company: str = "",
    bio: str = "",
    linkedin_url: str = "",
    image_path: str = "",
) -> dict:
    pan_id = secrets.token_hex(10)
    created_at = datetime.datetime.utcnow().isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO panelists(id,event_id,name,title,company,bio,linkedin_url,image_path,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (pan_id, event_id, name, title, company, bio, linkedin_url, image_path, created_at),
        )
        c.commit()
    return get_panelist(pan_id)


def get_panelist(pan_id: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute("SELECT * FROM panelists WHERE id = ?", (pan_id,)).fetchone()
    return dict(row) if row else None


def list_panelists(event_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM panelists WHERE event_id = ? ORDER BY name", (event_id,)).fetchall()
    return [dict(r) for r in rows]


def mark_panelist_encoded(pan_id: str) -> None:
    with _conn() as c:
        c.execute("UPDATE panelists SET face_encoded = 1 WHERE id = ?", (pan_id,))
        c.commit()


def delete_panelist(pan_id: str, event_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM panelists WHERE id = ? AND event_id = ?", (pan_id, event_id))
        c.commit()
    return cur.rowcount > 0


# ── Attendee tokens ──────────────────────────────────────────────────────────

def _generate_code() -> str:
    return "".join(random.choices(_CODE_CHARS, k=_CODE_LENGTH))


def _unique_code(c: sqlite3.Connection) -> str:
    for _ in range(20):
        code = _generate_code()
        exists = c.execute("SELECT 1 FROM attendee_tokens WHERE code = ?", (code,)).fetchone()
        if not exists:
            return code
    raise RuntimeError("Could not generate unique code after 20 attempts")


def generate_tokens(
    event_id: str,
    count: int,
    names: Optional[list[str]] = None,
    emails: Optional[list[str]] = None,
) -> list[dict]:
    created_at = datetime.datetime.utcnow().isoformat()
    tokens = []
    with _conn() as c:
        for i in range(count):
            tok_id = secrets.token_hex(10)
            code = _unique_code(c)
            name = names[i] if names and i < len(names) else ""
            email = emails[i] if emails and i < len(emails) else ""
            c.execute(
                "INSERT INTO attendee_tokens(id,event_id,code,attendee_name,attendee_email,created_at) VALUES (?,?,?,?,?,?)",
                (tok_id, event_id, code, name, email, created_at),
            )
            tokens.append({"id": tok_id, "event_id": event_id, "code": code, "attendee_name": name, "attendee_email": email})
        c.commit()
    return tokens


def list_tokens(event_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM attendee_tokens WHERE event_id = ? ORDER BY created_at", (event_id,)).fetchall()
    return [dict(r) for r in rows]


def validate_token(code: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute(
            "SELECT t.*, e.name AS event_name, e.description, e.date, e.location, e.organizer_id FROM attendee_tokens t JOIN events e ON t.event_id = e.id WHERE t.code = ?",
            (code,),
        ).fetchone()
    return dict(row) if row else None


def mark_token_used(code: str) -> None:
    used_at = datetime.datetime.utcnow().isoformat()
    with _conn() as c:
        c.execute("UPDATE attendee_tokens SET used_at = ? WHERE code = ? AND used_at IS NULL", (used_at, code))
        c.commit()


def delete_token(tok_id: str, event_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM attendee_tokens WHERE id = ? AND event_id = ?", (tok_id, event_id))
        c.commit()
    return cur.rowcount > 0


# ── Saved contacts ───────────────────────────────────────────────────────────

def save_contact(
    attendee_code: str,
    event_id: str,
    panelist_name: str,
    panelist_id: str = "",
) -> dict:
    contact_id = secrets.token_hex(10)
    saved_at = datetime.datetime.utcnow().isoformat()
    with _conn() as c:
        existing = c.execute(
            "SELECT id FROM saved_contacts WHERE attendee_code = ? AND panelist_name = ? AND event_id = ?",
            (attendee_code, panelist_name, event_id),
        ).fetchone()
        if existing:
            return dict(c.execute("SELECT * FROM saved_contacts WHERE id = ?", (existing["id"],)).fetchone())
        c.execute(
            "INSERT INTO saved_contacts(id,attendee_code,event_id,panelist_id,panelist_name,saved_at) VALUES (?,?,?,?,?,?)",
            (contact_id, attendee_code, event_id, panelist_id, panelist_name, saved_at),
        )
        c.commit()
    return {"id": contact_id, "attendee_code": attendee_code, "event_id": event_id, "panelist_id": panelist_id, "panelist_name": panelist_name, "saved_at": saved_at}


def list_saved_contacts(attendee_code: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            """SELECT sc.*, p.title, p.company, p.bio, p.linkedin_url, p.image_path
               FROM saved_contacts sc
               LEFT JOIN panelists p ON sc.panelist_id = p.id
               WHERE sc.attendee_code = ?
               ORDER BY sc.saved_at DESC""",
            (attendee_code,),
        ).fetchall()
    return [dict(r) for r in rows]


def event_stats(event_id: str) -> dict:
    with _conn() as c:
        panelist_count = c.execute("SELECT COUNT(*) FROM panelists WHERE event_id = ?", (event_id,)).fetchone()[0]
        token_count = c.execute("SELECT COUNT(*) FROM attendee_tokens WHERE event_id = ?", (event_id,)).fetchone()[0]
        used_count = c.execute("SELECT COUNT(*) FROM attendee_tokens WHERE event_id = ? AND used_at IS NOT NULL", (event_id,)).fetchone()[0]
        contact_count = c.execute("SELECT COUNT(*) FROM saved_contacts WHERE event_id = ?", (event_id,)).fetchone()[0]
    return {
        "panelist_count": panelist_count,
        "token_count": token_count,
        "used_count": used_count,
        "contact_count": contact_count,
    }
