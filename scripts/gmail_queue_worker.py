#!/usr/bin/env python3
"""Drain HM Finder's Gmail-draft queue without Apps Script or paid cron services."""

import base64
import imaplib
import json
import os
import smtplib
import sys
import uuid
from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import format_datetime, make_msgid

DRAFTS = '"[Gmail]/Drafts"'
QUEUE_SUBJECT = "[HM Finder Queue]"


def now():
    return datetime.now(timezone.utc)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def next_business_day(value=None):
    value = (value or now()) + timedelta(days=1)
    while value.weekday() >= 5:
        value += timedelta(days=1)
    return value


def make_draft(item, sender):
    payload = base64.b64encode(json.dumps(item).encode()).decode()
    return (
        f"From: {sender}\r\nTo: {sender}\r\nSubject: {QUEUE_SUBJECT} {item['id']}\r\n"
        "X-HM-Finder-Queue: 1\r\nMIME-Version: 1.0\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        f"Content-Transfer-Encoding: base64\r\n\r\n{payload}\r\n"
    ).encode()


def queue_followup(imap, item, message_id, sender):
    followup = {
        "id": str(uuid.uuid4()), "to": item["to"], "subject": item["subject"],
        "text": item["followup1"], "sendAt": next_business_day().isoformat(),
        "queuedAt": now().isoformat(), "stage": 1, "initialSentAt": now().isoformat(),
        "inReplyTo": message_id, "company": item.get("company"), "role": item.get("role"),
    }
    status, _ = imap.append(DRAFTS, "\\Draft", imaplib.Time2Internaldate(datetime.now()), make_draft(followup, sender))
    if status != "OK": raise RuntimeError("could not queue follow-up")


def replied(imap, item):
    imap.select("INBOX", readonly=True)
    since = parse_time(item["initialSentAt"]).strftime("%d-%b-%Y")
    status, rows = imap.search(None, f'(FROM "{item["to"]}" SINCE "{since}")')
    return status == "OK" and bool(rows[0].split())


def send(item, sender, password):
    msg = EmailMessage()
    msg["From"], msg["To"] = sender, item["to"]
    msg["Subject"] = f"Re: {item['subject']}" if item.get("stage") == 1 and not item["subject"].lower().startswith("re:") else item["subject"]
    if item.get("inReplyTo"):
        msg["In-Reply-To"] = item["inReplyTo"]
        msg["References"] = item["inReplyTo"]
    msg["Date"] = format_datetime(now())
    msg["Message-ID"] = make_msgid(domain="gmail.com")
    msg.set_content(item["text"])
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)
    return msg["Message-ID"]


def main():
    sender, password = os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    limit = int(os.getenv("HM_FINDER_BATCH_SIZE", "10"))
    result = {"sent": 0, "skippedReplies": 0, "pending": 0, "errors": []}
    with imaplib.IMAP4_SSL("imap.gmail.com", 993) as imap:
        imap.login(sender, password)
        imap.select(DRAFTS)
        status, rows = imap.search(None, f'(SUBJECT "{QUEUE_SUBJECT}")')
        ids = rows[0].split() if status == "OK" else []
        due = []
        for msg_id in ids:
            status, data = imap.fetch(msg_id, "(RFC822)")
            if status != "OK": continue
            message = BytesParser(policy=policy.default).parsebytes(data[0][1])
            if message.get("X-HM-Finder-Queue") != "1": continue
            try:
                item = json.loads(message.get_payload(decode=True).decode())
                if parse_time(item["sendAt"]) <= now(): due.append((msg_id, item))
            except Exception as exc:
                result["errors"].append({"id": msg_id.decode(), "error": str(exc)})
        due.sort(key=lambda row: row[1]["sendAt"])
        result["pending"] = len(due)
        for msg_id, item in due[:limit]:
            try:
                if item.get("stage") == 1 and replied(imap, item):
                    imap.select(DRAFTS); imap.store(msg_id, "+FLAGS", "\\Deleted"); imap.expunge()
                    result["skippedReplies"] += 1; continue
                message_id = send(item, sender, password)
                imap.select(DRAFTS); imap.store(msg_id, "+FLAGS", "\\Deleted"); imap.expunge()
                result["sent"] += 1
                if item.get("stage", 0) == 0 and item.get("followup1"): queue_followup(imap, item, message_id, sender)
            except Exception as exc:
                result["errors"].append({"id": item.get("id"), "error": str(exc)})
    print(json.dumps(result))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
