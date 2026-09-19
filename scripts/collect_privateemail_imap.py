#!/usr/bin/env python3
"""Read one Private Email inbox over IMAPS without changing mailbox state."""

import argparse
import email
import hashlib
import imaplib
import json
import os
import re
import ssl
import subprocess
from datetime import date as Date, datetime, timedelta
from email import policy
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path


HOST = "mail.privateemail.com"
PORT = 993


def header(value):
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return str(value or "")


def addresses(msg, name):
    return header(msg.get(name, ""))


def safe_name(value):
    value = re.sub(r"[^a-zA-Z0-9._ -]", "_", value or "attachment")[:120]
    return value or "attachment"


def body_text(msg):
    preferred = []
    fallback = []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_disposition() == "attachment":
            continue
        kind = part.get_content_type()
        if kind not in ("text/plain", "text/html"):
            continue
        try:
            text = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        (preferred if kind == "text/plain" else fallback).append(str(text))
    return "\n".join(preferred or fallback)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report_date")
    parser.add_argument("account")
    parser.add_argument("keychain_service")
    parser.add_argument("output_dir")
    args = parser.parse_args()

    report_date = Date.fromisoformat(args.report_date)
    keychain = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", args.account,
         "-s", args.keychain_service, "-w"],
        check=True, capture_output=True, text=True, timeout=15,
    )
    password = keychain.stdout.rstrip("\r\n")
    if not password:
        raise RuntimeError(f"keychain credential unavailable: {args.keychain_service}")

    output_dir = Path(args.output_dir).resolve()
    attachment_dir = output_dir / args.account / "attachments"
    context = ssl.create_default_context()
    messages = []
    warnings = []

    with imaplib.IMAP4_SSL(HOST, PORT, ssl_context=context, timeout=30) as client:
        client.login(args.account, password)
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("unable to select INBOX read-only")
        status, data = client.uid(
            "search", None,
            "SINCE", report_date.strftime("%d-%b-%Y"),
            "BEFORE", (report_date + timedelta(days=1)).strftime("%d-%b-%Y"),
        )
        if status != "OK":
            raise RuntimeError("IMAP UID search failed")

        for uid in (data[0] or b"").split():
            status, fetched = client.uid("fetch", uid, "(INTERNALDATE BODY.PEEK[])")
            if status != "OK" or not fetched:
                warnings.append("message_fetch_failed")
                continue
            meta = b""
            raw = b""
            for item in fetched:
                if isinstance(item, tuple):
                    meta += item[0]
                    raw += item[1]
            match = re.search(rb'INTERNALDATE "([^"]+)"', meta)
            internal_dt = parsedate_to_datetime(match.group(1).decode()) if match else None
            msg = email.message_from_bytes(raw, policy=policy.default)
            item = {
                "providerId": uid.decode(),
                "folder": "INBOX",
                "date": internal_dt.isoformat() if internal_dt else header(msg.get("Date")),
                "dateBasis": "IMAP INTERNALDATE" if internal_dt else "message Date header",
                "messageId": header(msg.get("Message-ID")),
                "from": addresses(msg, "From"),
                "to": addresses(msg, "To"),
                "cc": addresses(msg, "Cc"),
                "subject": header(msg.get("Subject")),
                "body": body_text(msg),
                "attachments": [],
                "warnings": [],
            }
            for index, part in enumerate(msg.walk()):
                filename = part.get_filename()
                if not filename and part.get_content_disposition() != "attachment":
                    continue
                filename = header(filename or f"attachment-{index}")
                payload = part.get_payload(decode=True) or b""
                digest = hashlib.sha256(uid + b":" + str(index).encode()).hexdigest()[:20]
                attachment_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                target = attachment_dir / f"{digest}-{safe_name(filename)}"
                target.write_bytes(payload)
                os.chmod(target, 0o600)
                item["attachments"].append({
                    "name": filename,
                    "mimeType": part.get_content_type(),
                    "size": len(payload),
                    "path": str(target),
                    "status": "downloaded",
                })
            messages.append(item)
        client.logout()

    print(json.dumps({
        "status": "partial" if warnings else "ok",
        "warnings": warnings,
        "messages": messages,
        "connection": "imaps-readonly",
    }))


if __name__ == "__main__":
    main()
