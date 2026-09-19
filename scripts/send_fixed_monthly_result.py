#!/usr/bin/env python3
"""Email the owner after a Fixed Monthly submission reaches a terminal state."""
from __future__ import annotations

import argparse
import html
import json
import smtplib
import ssl
import subprocess
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

from fixed_monthly_approval import AUTHORIZED_RECIPIENT, atomic_json


ACCOUNT = "jason@jeclogs.com"
KEYCHAIN_SERVICE = "openclaw-jeclogs-imap-jason"


def send(state_path: Path, dry_run: bool = False) -> dict:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["status"] not in {"submitted", "submission_unknown"}:
        raise RuntimeError(f"submission is not terminal: {state['status']}")
    if state.get("result_email"):
        return {"already_sent": True, "approval_id": state["approval_id"]}
    submitted = state["status"] == "submitted"
    subject = (
        "FILED — Fixed Monthly Dispute" if submitted
        else "ACTION REQUIRED — Fixed Monthly Submission Uncertain"
    ) + f" — {state['invoice']['service_month']} [{state['approval_id']}]"
    confirmation = state.get("submission", {}).get("confirmation") or "Unavailable"
    body = f"""<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45">
      <h1>{'Dispute filed' if submitted else 'Submission requires verification'}</h1>
      <p><strong>Invoice:</strong> {html.escape(state['invoice']['invoice_number'])}<br>
      <strong>Approval ID:</strong> {html.escape(state['approval_id'])}<br>
      <strong>Status:</strong> {html.escape(state['status'])}<br>
      <strong>Amazon confirmation:</strong> {html.escape(confirmation)}</p>
      <p>{'No further action is required unless Amazon requests more evidence.' if submitted else 'Do not retry automatically. Check the Amazon Disputes tab before taking another action.'}</p>
    </body></html>"""
    if dry_run:
        return {"validated": True, "to": AUTHORIZED_RECIPIENT, "subject": subject}
    password = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
        check=True, capture_output=True, text=True, timeout=15,
    ).stdout.rstrip("\r\n")
    message = EmailMessage()
    message["From"] = ACCOUNT
    message["To"] = AUTHORIZED_RECIPIENT
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain="jeclogs.com")
    message["X-JECS-Approval-ID"] = state["approval_id"]
    message.set_content(f"{state['status']}: {state['invoice']['invoice_number']} — {confirmation}")
    message.add_alternative(body, subtype="html")
    with smtplib.SMTP_SSL("mail.privateemail.com", 465, context=ssl.create_default_context(), timeout=45) as client:
        client.login(ACCOUNT, password)
        refused = client.send_message(message, from_addr=ACCOUNT, to_addrs=[AUTHORIZED_RECIPIENT])
        if refused:
            raise RuntimeError("SMTP server refused the result email")
    state["result_email"] = {
        "sent_at": datetime.now(timezone.utc).isoformat(), "message_id": message["Message-ID"].strip("<>"),
        "recipient": AUTHORIZED_RECIPIENT,
    }
    state["events"].append({"at": state["result_email"]["sent_at"], "event": "result_email_sent"})
    atomic_json(state_path, state)
    return {"sent": True, "approval_id": state["approval_id"], "message_id": state["result_email"]["message_id"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(send(args.state.resolve(strict=True), args.dry_run)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
