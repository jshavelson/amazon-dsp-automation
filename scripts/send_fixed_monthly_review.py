#!/usr/bin/env python3
"""Send one approval-gated Fixed Monthly review to the owner mailbox."""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import subprocess
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

from fixed_monthly_approval import AUTHORIZED_RECIPIENT, atomic_json, verify_immutable_sources


ACCOUNT = "jason@jeclogs.com"
KEYCHAIN_SERVICE = "openclaw-jeclogs-imap-jason"
SMTP_HOST = "mail.privateemail.com"
SMTP_PORT = 465


def send(state_path: Path, dry_run: bool = False) -> dict:
    state_path = state_path.resolve(strict=True)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["recipient"] != AUTHORIZED_RECIPIENT:
        raise RuntimeError("recipient is not authorized")
    if state["status"] not in {"prepared", "prepared_no_dispute"}:
        if state["status"] in {"awaiting_approval", "notified_no_dispute"}:
            return {"already_sent": True, "approval_id": state["approval_id"], "status": state["status"]}
        raise RuntimeError(f"state is not sendable: {state['status']}")
    verify_immutable_sources(state)
    html_path = state_path.parent / "review.html"
    if not html_path.exists():
        raise RuntimeError("review HTML is missing")
    subject_prefix = "ACTION REQUIRED" if state.get("candidate") else "REVIEW COMPLETE"
    subject = f"{subject_prefix} — Fixed Monthly Fleet Review — {state['invoice']['service_month']} [{state['approval_id']}]"
    if dry_run:
        return {
            "validated": True, "to": AUTHORIZED_RECIPIENT, "subject": subject,
            "approval_id": state["approval_id"], "attachment": state["pdf"]["path"],
        }
    lock = state_path.parent / "send.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise RuntimeError("send is locked; inspect mailbox before retrying") from error
    os.write(descriptor, datetime.now(timezone.utc).isoformat().encode())
    os.close(descriptor)
    message_id = make_msgid(domain="jeclogs.com")
    try:
        password = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-a", ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
            check=True, capture_output=True, text=True, timeout=15,
        ).stdout.rstrip("\r\n")
        if not password:
            raise RuntimeError("SMTP credential unavailable")
        message = EmailMessage()
        message["From"] = ACCOUNT
        message["To"] = AUTHORIZED_RECIPIENT
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = message_id
        message["X-JECS-Approval-ID"] = state["approval_id"]
        message["X-JECS-Report-SHA256"] = state["report"]["sha256"]
        message.set_content(
            "Fixed Monthly Fleet Review. Open the HTML version for detail. "
            + ("Reply YES in this thread to authorize the identified dispute." if state.get("candidate") else "No dispute was identified.")
        )
        message.add_alternative(html_path.read_text(encoding="utf-8"), subtype="html")
        pdf_path = Path(state["pdf"]["path"])
        message.add_attachment(pdf_path.read_bytes(), maintype="application", subtype="pdf", filename=pdf_path.name)
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=45) as client:
            client.login(ACCOUNT, password)
            refused = client.send_message(message, from_addr=ACCOUNT, to_addrs=[AUTHORIZED_RECIPIENT])
            if refused:
                raise RuntimeError("SMTP server refused the authorized recipient")
        state["sent"] = {
            "at": datetime.now(timezone.utc).isoformat(), "message_id": message_id.strip("<>"),
            "subject": subject, "recipient": AUTHORIZED_RECIPIENT, "provider": "privateemail-smtp",
        }
        state["status"] = "awaiting_approval" if state.get("candidate") else "notified_no_dispute"
        state["events"].append({"at": state["sent"]["at"], "event": "review_email_sent", "message_id": state["sent"]["message_id"]})
        atomic_json(state_path, state)
        lock.unlink()
        return {"sent": True, "approval_id": state["approval_id"], "message_id": state["sent"]["message_id"], "status": state["status"]}
    except Exception:
        # Retain the lock because SMTP failure can be an unknown-delivery result.
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(send(args.state, args.dry_run)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
