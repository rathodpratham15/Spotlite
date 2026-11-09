"""SMTP email sending for attendee code distribution."""

from __future__ import annotations

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional


def _smtp_config() -> dict:
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": os.getenv("SMTP_USER", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_name": os.getenv("SMTP_FROM_NAME", "Spotlite"),
        "from_email": os.getenv("SMTP_FROM_EMAIL", os.getenv("SMTP_USER", "")),
    }


def send_attendee_code(
    to_email: str,
    to_name: str,
    event_name: str,
    event_date: str,
    code: str,
    organizer_name: str = "",
) -> bool:
    cfg = _smtp_config()
    if not cfg["user"] or not cfg["password"]:
        return False

    subject = f"Your access code for {event_name}"
    display_name = to_name or "there"
    organizer_line = f"<p>See you at the event,<br><strong>{organizer_name}</strong></p>" if organizer_name else ""

    html = f"""
    <html><body style="font-family: sans-serif; color: #111; background: #fff; max-width: 480px; margin: 40px auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h1 style="font-size: 22px; margin-bottom: 4px;">You're in.</h1>
      <p style="color: #6b7280; margin-top: 0;">Here's your access code for <strong>{event_name}</strong>{(' on ' + event_date) if event_date else ''}.</p>
      <div style="text-align: center; margin: 32px 0;">
        <div style="display: inline-block; background: #f3f4f6; border-radius: 8px; padding: 20px 40px;">
          <div style="font-size: 11px; letter-spacing: 2px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px;">Your Access Code</div>
          <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; font-family: monospace;">{code}</div>
        </div>
      </div>
      <p>Hi {display_name}, enter this code on the Spotlite scanner page when you arrive at the event to unlock the attendee experience.</p>
      {organizer_line}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="font-size: 11px; color: #9ca3af;">This code is unique to you. Do not share it.</p>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
    msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"]) as server:
            server.ehlo()
            server.starttls()
            server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["from_email"], [to_email], msg.as_string())
        return True
    except Exception:
        return False


def bulk_send(tokens: list[dict], event_name: str, event_date: str, organizer_name: str = "") -> dict:
    sent = 0
    failed = 0
    skipped = 0
    for tok in tokens:
        email = (tok.get("attendee_email") or "").strip()
        if not email:
            skipped += 1
            continue
        ok = send_attendee_code(
            to_email=email,
            to_name=tok.get("attendee_name") or "",
            event_name=event_name,
            event_date=event_date,
            code=tok["code"],
            organizer_name=organizer_name,
        )
        if ok:
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "skipped": skipped}
