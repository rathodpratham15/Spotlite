"""Spotlite Flask API."""

from __future__ import annotations

import io
import logging
import os
import tempfile
import urllib.parse
from functools import wraps
from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

from spotlite.core import auth as auth_store
from spotlite.core import event_store
from spotlite.core import mailer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_DATA_DIR = Path(os.getenv("SPOTLITE_DATA_DIR", "data"))
_FACES_DIR = _DATA_DIR / "faces"

app = Flask(__name__)
CORS(app, origins=os.getenv("SPOTLITE_CORS_ORIGINS", "*").split(","), supports_credentials=True)

# ── DB init ──────────────────────────────────────────────────────────────────

auth_store.init_db()
event_store.init_db()

# ── Face engine cache ────────────────────────────────────────────────────────

_engines: dict = {}


def _get_engine(namespace: str):
    from spotlite.vision.faces import FaceRecognitionEngine
    if namespace not in _engines:
        _engines[namespace] = FaceRecognitionEngine(data_dir=_FACES_DIR / namespace)
    return _engines[namespace]


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _current_organizer() -> Optional[dict]:
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    if not token:
        token = request.cookies.get("spotlite_token", "")
    if not token:
        return None
    return auth_store.verify_token(token)


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        organizer = _current_organizer()
        if not organizer:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, organizer=organizer, **kwargs)
    return wrapper


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "spotlite"})


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register():
    data = request.get_json(force=True) or {}
    try:
        organizer = auth_store.register(data.get("email", ""), data.get("name", ""), data.get("password", ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    token = auth_store.login(data["email"], data["password"])
    return jsonify({"token": token, "organizer": organizer}), 201


@app.post("/api/auth/login")
def login():
    data = request.get_json(force=True) or {}
    token = auth_store.login(data.get("email", ""), data.get("password", ""))
    if not token:
        return jsonify({"error": "Invalid credentials"}), 401
    payload = auth_store.verify_token(token)
    return jsonify({"token": token, "organizer": {"id": payload["sub"], "email": payload["email"], "name": payload["name"]}})


@app.get("/api/auth/me")
@require_auth
def me(organizer):
    return jsonify(organizer)


# ── Events ───────────────────────────────────────────────────────────────────

@app.get("/api/events")
@require_auth
def list_events(organizer):
    events = event_store.list_events(organizer["sub"])
    for ev in events:
        ev["stats"] = event_store.event_stats(ev["id"])
    return jsonify(events)


@app.post("/api/events")
@require_auth
def create_event(organizer):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    ev = event_store.create_event(
        name=name,
        organizer_id=organizer["sub"],
        organizer_name=organizer.get("name", ""),
        description=data.get("description", ""),
        date=data.get("date", ""),
        location=data.get("location", ""),
    )
    ev["stats"] = event_store.event_stats(ev["id"])
    return jsonify(ev), 201


@app.get("/api/events/<event_id>")
@require_auth
def get_event(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    ev["stats"] = event_store.event_stats(event_id)
    return jsonify(ev)


@app.patch("/api/events/<event_id>")
@require_auth
def update_event(organizer, event_id):
    data = request.get_json(force=True) or {}
    ev = event_store.update_event(event_id, organizer["sub"], **data)
    if not ev:
        return jsonify({"error": "Not found"}), 404
    return jsonify(ev)


@app.delete("/api/events/<event_id>")
@require_auth
def delete_event(organizer, event_id):
    ok = event_store.delete_event(event_id, organizer["sub"])
    if not ok:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"deleted": True})


# ── Panelists ────────────────────────────────────────────────────────────────

@app.get("/api/events/<event_id>/panelists")
@require_auth
def list_panelists(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    panelists = event_store.list_panelists(event_id)
    for p in panelists:
        if p.get("image_path"):
            p["image_url"] = f"/api/events/{event_id}/panelists/{p['id']}/photo"
        else:
            p["image_url"] = None
    return jsonify(panelists)


@app.post("/api/events/<event_id>/panelists")
@require_auth
def add_panelist(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404

    name = (request.form.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    image_path = ""
    if "photo" in request.files:
        photo = request.files["photo"]
        dest_dir = _FACES_DIR / f"event_{event_id}" / "images"
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        dest = dest_dir / f"{safe_name}{ext}"
        photo.save(str(dest))
        image_path = str(dest)

    panelist = event_store.add_panelist(
        event_id=event_id,
        name=name,
        title=request.form.get("title", ""),
        company=request.form.get("company", ""),
        bio=request.form.get("bio", ""),
        linkedin_url=request.form.get("linkedin_url", ""),
        image_path=image_path,
    )

    if image_path:
        try:
            engine = _get_engine(f"event_{event_id}")
            person = engine.add_person(name, [image_path], metadata={"title": panelist.get("title"), "company": panelist.get("company")})
            if person:
                event_store.mark_panelist_encoded(panelist["id"])
                panelist["face_encoded"] = 1
        except Exception as exc:
            logger.warning("Face encoding failed for %s: %s", name, exc)

    panelist["image_url"] = f"/api/events/{event_id}/panelists/{panelist['id']}/photo" if image_path else None
    return jsonify(panelist), 201


@app.get("/api/events/<event_id>/panelists/<pan_id>/photo")
def panelist_photo(event_id, pan_id):
    pan = event_store.get_panelist(pan_id)
    if not pan or pan["event_id"] != event_id or not pan.get("image_path"):
        return jsonify({"error": "Not found"}), 404
    path = Path(pan["image_path"])
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(path))


@app.delete("/api/events/<event_id>/panelists/<pan_id>")
@require_auth
def delete_panelist(organizer, event_id, pan_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    ok = event_store.delete_panelist(pan_id, event_id)
    if not ok:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"deleted": True})


# ── Tokens ───────────────────────────────────────────────────────────────────

@app.get("/api/events/<event_id>/tokens")
@require_auth
def list_tokens(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    return jsonify(event_store.list_tokens(event_id))


@app.post("/api/events/<event_id>/tokens")
@require_auth
def generate_tokens(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json(force=True) or {}
    count = int(data.get("count", 1))
    if count < 1 or count > 500:
        return jsonify({"error": "count must be 1–500"}), 400
    names = data.get("names") or []
    emails = data.get("emails") or []
    tokens = event_store.generate_tokens(event_id, count, names or None, emails or None)
    return jsonify(tokens), 201


@app.delete("/api/events/<event_id>/tokens/<tok_id>")
@require_auth
def delete_token(organizer, event_id, tok_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    ok = event_store.delete_token(tok_id, event_id)
    return jsonify({"deleted": ok})


@app.post("/api/events/<event_id>/tokens/send-emails")
@require_auth
def send_emails(organizer, event_id):
    ev = event_store.get_event(event_id)
    if not ev or ev["organizer_id"] != organizer["sub"]:
        return jsonify({"error": "Not found"}), 404
    tokens = event_store.list_tokens(event_id)
    result = mailer.bulk_send(tokens, ev["name"], ev.get("date", ""), organizer.get("name", ""))
    return jsonify(result)


# ── Attendee (public) endpoints ───────────────────────────────────────────────

@app.post("/api/attend/validate")
def validate_code():
    data = request.get_json(force=True) or {}
    code = (data.get("code") or "").strip().upper()
    token_data = event_store.validate_token(code)
    if not token_data:
        return jsonify({"error": "Invalid or expired code"}), 404
    event_store.mark_token_used(code)
    return jsonify({
        "valid": True,
        "event_id": token_data["event_id"],
        "event_name": token_data["event_name"],
        "event_date": token_data.get("date", ""),
        "event_location": token_data.get("location", ""),
        "attendee_name": token_data.get("attendee_name", ""),
        "code": code,
    })


@app.post("/api/attend/scan")
def scan_face():
    code = (request.form.get("code") or "").strip().upper()
    if not code:
        return jsonify({"error": "code required"}), 400
    token_data = event_store.validate_token(code)
    if not token_data:
        return jsonify({"error": "Invalid code"}), 403

    event_id = token_data["event_id"]
    if "photo" not in request.files:
        return jsonify({"error": "photo required"}), 400

    photo = request.files["photo"]
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        photo.save(tmp.name)
        tmp_path = tmp.name

    try:
        engine = _get_engine(f"event_{event_id}")
        result = engine.recognize_face(tmp_path)
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass

    if not result.matched or not result.person:
        return jsonify({"matched": False, "confidence": result.confidence})

    person = result.person
    panelist_id = ""
    panelists = event_store.list_panelists(event_id)
    for p in panelists:
        if p["name"].lower() == person.name.lower():
            panelist_id = p["id"]
            break

    contact = event_store.save_contact(
        attendee_code=code,
        event_id=event_id,
        panelist_name=person.name,
        panelist_id=panelist_id,
    )

    return jsonify({
        "matched": True,
        "confidence": result.confidence,
        "name": person.name,
        "title": person.profession or "",
        "panelist_id": panelist_id,
        "contact": contact,
        "image_url": f"/api/events/{event_id}/panelists/{panelist_id}/photo" if panelist_id else None,
    })


@app.get("/api/attend/contacts")
def attendee_contacts():
    code = (request.args.get("code") or "").strip().upper()
    if not code:
        return jsonify({"error": "code required"}), 400
    token_data = event_store.validate_token(code)
    if not token_data:
        return jsonify({"error": "Invalid code"}), 403
    contacts = event_store.list_saved_contacts(code)
    for c in contacts:
        if c.get("image_path"):
            c["image_url"] = f"/api/events/{token_data['event_id']}/panelists/{c.get('panelist_id', '')}/photo"
        else:
            c["image_url"] = None
    return jsonify({
        "event_name": token_data["event_name"],
        "contacts": contacts,
    })
