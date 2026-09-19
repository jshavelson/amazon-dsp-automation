#!/usr/bin/env python3
"""Read owner mailbox replies and apply exact YES/NO Fixed Monthly decisions."""
from __future__ import annotations

import argparse
import email
import hashlib
import imaplib
import json
import re
import ssl
import subprocess
from datetime import datetime, timedelta, timezone
from email import policy
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path

from fixed_monthly_approval import AUTHORIZED_RECIPIENT, DEFAULT_QUEUE, apply_decision


HOST = "mail.privateemail.com"
PORT = 993
KEYCHAIN_SERVICE = "openclaw-jeclogs-imap-jason"


def header(value: str | None) -> str:
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return str(value or "")


def message_body(message: email.message.EmailMessage) -> str:
    plain = []
    html_parts = []
    parts = message.walk() if message.is_multipart() else [message]
    for part in parts:
        if part.get_content_disposition() == "attachment":
            continue
        kind = part.get_content_type()
        if kind not in {"text/plain", "text/html"}:
            continue
        try:
            content = str(part.get_content())
        except Exception:
            payload = part.get_payload(decode=True) or b""
            content = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        (plain if kind == "text/plain" else html_parts).append(content)
    body = "\n".join(plain or html_parts)
    body = re.sub(r"<blockquote\b[^>]*>[\s\S]*", "", body, flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.split(r"\n\s*On .+wrote:\s*", body, maxsplit=1, flags=re.I)[0]
    body = re.split(r"\n\s*-{2,}\s*Original Message\s*-{2,}", body, maxsplit=1, flags=re.I)[0]
    lines = []
    for line in body.splitlines():
        value = line.strip()
        if not value or value.startswith(">"):
            continue
        lines.append(value)
    return "\n".join(lines).strip()


def exact_decision(body: str) -> str | None:
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not lines:
        return None
    normalized = re.sub(r"[.!]$", "", lines[0]).upper()
    if normalized not in {"YES", "NO"}:
        return None
    if len(lines) == 1:
        return normalized
    # Outlook commonly appends a signature and the complete original message
    # without a standard quote delimiter. Accept the exact first-line decision
    # only when the remainder contains an Outlook-style quoted header.
    has_quoted_header = any(line.lower().startswith("from:") for line in lines[1:]) and any(
        line.lower().startswith("subject:") for line in lines[1:]
    )
    return normalized if has_quoted_header else None


def parsed_message(raw: bytes, fallback_date: datetime | None = None) -> dict:
    message = email.message_from_bytes(raw, policy=policy.default)
    from_addresses = [address.lower() for _, address in getaddresses([header(message.get("From"))])]
    date_header = header(message.get("Date"))
    try:
        received_at = parsedate_to_datetime(date_header)
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
    except Exception:
        received_at = fallback_date or datetime.now(timezone.utc)
    body = message_body(message)
    return {
        "message_id": header(message.get("Message-ID")).strip("<>"),
        "in_reply_to": header(message.get("In-Reply-To")),
        "references": header(message.get("References")),
        "subject": header(message.get("Subject")),
        "from_addresses": from_addresses,
        "received_at": received_at.astimezone(timezone.utc).isoformat(),
        "body": body,
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
    }


def load_states(queue: Path) -> list[tuple[Path, dict]]:
    result = []
    if not queue.exists():
        return result
    for state_path in sorted(queue.glob("*/approval.json")):
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("status") == "awaiting_approval":
            result.append((state_path, state))
    return result


def match_and_apply(messages: list[dict], states: list[tuple[Path, dict]]) -> list[dict]:
    outcomes = []
    for state_path, state in states:
        original = state["sent"]["message_id"].strip("<>")
        sent_at = datetime.fromisoformat(state["sent"]["at"]).astimezone(timezone.utc)
        matches = []
        for item in messages:
            if AUTHORIZED_RECIPIENT not in item["from_addresses"]:
                continue
            if item["message_id"].strip("<>") == original:
                continue
            threading = f"{item['in_reply_to']} {item['references']}"
            if original not in threading:
                continue
            # Message Date headers are commonly second-granularity and may be a
            # few seconds behind the SMTP receipt time. Thread identity remains
            # mandatory; allow only a small timestamp skew.
            if datetime.fromisoformat(item["received_at"]).astimezone(timezone.utc) < sent_at - timedelta(minutes=5):
                continue
            matches.append(item)
        matches.sort(key=lambda item: item["received_at"])
        applied = False
        for item in matches:
            decision = exact_decision(item["body"])
            if not decision:
                continue
            updated = apply_decision(state_path, {
                "decision": decision,
                "from": AUTHORIZED_RECIPIENT,
                "received_at": item["received_at"],
                "reply_message_id": item["message_id"],
                "reply_sha256": item["raw_sha256"],
                "original_message_id": original,
            })
            outcomes.append({"approval_id": state["approval_id"], "status": updated["status"], "reply_message_id": item["message_id"]})
            applied = True
            break
        if matches and not applied:
            outcomes.append({"approval_id": state["approval_id"], "status": "ambiguous_reply_ignored", "matches": len(matches)})
    return outcomes


def read_fixture(directory: Path) -> list[dict]:
    return [parsed_message(path.read_bytes()) for path in sorted(directory.glob("*.eml"))]


def read_imap(states: list[tuple[Path, dict]]) -> list[dict]:
    if not states:
        return []
    earliest = min(datetime.fromisoformat(state["sent"]["at"]) for _, state in states) - timedelta(days=1)
    password = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", AUTHORIZED_RECIPIENT, "-s", KEYCHAIN_SERVICE, "-w"],
        check=True, capture_output=True, text=True, timeout=15,
    ).stdout.rstrip("\r\n")
    if not password:
        raise RuntimeError("IMAP credential unavailable")
    result = []
    with imaplib.IMAP4_SSL(HOST, PORT, ssl_context=ssl.create_default_context(), timeout=30) as client:
        client.login(AUTHORIZED_RECIPIENT, password)
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("unable to select INBOX read-only")
        status, data = client.uid("search", None, "SINCE", earliest.strftime("%d-%b-%Y"))
        if status != "OK":
            raise RuntimeError("IMAP search failed")
        for uid in (data[0] or b"").split():
            status, fetched = client.uid("fetch", uid, "(BODY.PEEK[])")
            if status != "OK":
                continue
            raw = b"".join(item[1] for item in fetched if isinstance(item, tuple))
            if raw:
                result.append(parsed_message(raw))
        client.logout()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--fixture", type=Path)
    args = parser.parse_args()
    states = load_states(args.queue.resolve())
    messages = read_fixture(args.fixture.resolve()) if args.fixture else read_imap(states)
    outcomes = match_and_apply(messages, states)
    print(json.dumps({"awaiting": len(states), "messages_scanned": len(messages), "outcomes": outcomes}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
