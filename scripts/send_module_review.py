#!/usr/bin/env python3
"""Send a generic module review after validating its immutable evidence."""
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

from module_approval import AUTHORIZED_RECIPIENT, atomic_json, verify_immutable_sources


ACCOUNT = AUTHORIZED_RECIPIENT
KEYCHAIN_SERVICE = "openclaw-jeclogs-imap-jason"


def send(state_path: Path, dry_run: bool = False) -> dict:
    state_path = state_path.resolve(strict=True)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["recipient"] != AUTHORIZED_RECIPIENT or state["status"] not in {"prepared", "prepared_no_dispute"}:
        if state.get("status") in {"awaiting_approval", "notified_no_dispute"}:
            return {"already_sent": True, "approval_id": state["approval_id"]}
        raise RuntimeError(f"state is not sendable: {state.get('status')}")
    verify_immutable_sources(state)
    needs_approval = bool(state.get("candidates"))
    subject_prefix = "ACTION REQUIRED" if needs_approval else "REVIEW COMPLETE"
    subject = f"{subject_prefix} — {state['module_id'].replace('_',' ').title()} — {state['external_key']} [{state['approval_id']}]"
    if dry_run:
        return {"validated": True, "to": AUTHORIZED_RECIPIENT, "subject": subject, "approval_id": state["approval_id"]}
    lock = state_path.parent / "send.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise RuntimeError("send is locked; inspect mailbox before retrying") from exc
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
        message["X-JECS-Case-SHA256"] = state["case"]["sha256"]
        message.set_content("Open the HTML version for detail. " + ("Reply YES in this thread to authorize only this case, or NO to decline." if needs_approval else "No dispute candidate was identified; no reply is required."))
        message.add_alternative((state_path.parent / "review.html").read_text(encoding="utf-8"), subtype="html")
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("mail.privateemail.com", 465, context=context, timeout=45) as client:
            client.login(ACCOUNT, password)
            refused = client.send_message(message, from_addr=ACCOUNT, to_addrs=[AUTHORIZED_RECIPIENT])
            if refused:
                raise RuntimeError("SMTP server refused the authorized recipient")
        state["sent"] = {"at": datetime.now(timezone.utc).isoformat(), "message_id": message_id.strip("<>"), "subject": subject, "recipient": AUTHORIZED_RECIPIENT, "provider": "privateemail-smtp"}
        state["status"] = "awaiting_approval" if needs_approval else "notified_no_dispute"
        state["events"].append({"at": state["sent"]["at"], "event": "review_email_sent", "message_id": state["sent"]["message_id"]})
        atomic_json(state_path, state)
        lock.unlink()
        return {"sent": True, "approval_id": state["approval_id"], "message_id": state["sent"]["message_id"], "status": state["status"]}
    except Exception:
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
