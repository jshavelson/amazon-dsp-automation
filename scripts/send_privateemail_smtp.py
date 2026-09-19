#!/usr/bin/env python3
"""Send one fixed-account HTML message through Private Email SMTP.

The mailbox password is read from macOS Keychain in-process and is never
accepted on the command line or emitted to stdout/stderr.
"""

import argparse
import json
import smtplib
import ssl
import subprocess
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path


ACCOUNT = "jason@jeclogs.com"
KEYCHAIN_SERVICE = "openclaw-jeclogs-imap-jason"
SMTP_HOST = "mail.privateemail.com"
SMTP_PORT = 465


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--html-file", required=True)
    parser.add_argument("--auth-check", action="store_true")
    args = parser.parse_args()

    if args.to not in {"jason@jeclogs.com", "management@jeclogs.com"}:
        raise RuntimeError("recipient is not authorized")

    keychain = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", ACCOUNT,
         "-s", KEYCHAIN_SERVICE, "-w"],
        check=True, capture_output=True, text=True, timeout=15,
    )
    password = keychain.stdout.rstrip("\r\n")
    if not password:
        raise RuntimeError("SMTP credential unavailable")

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=45) as client:
        client.login(ACCOUNT, password)
        if args.auth_check:
            print(json.dumps({"authenticated": True, "provider": "privateemail-smtp"}))
            return

        html_path = Path(args.html_file).resolve(strict=True)
        html = html_path.read_text(encoding="utf-8")
        if not html.strip():
            raise RuntimeError("empty HTML body")

        message_id = make_msgid(domain="jeclogs.com")
        message = EmailMessage()
        message["From"] = ACCOUNT
        message["To"] = args.to
        message["Subject"] = args.subject
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = message_id
        message.set_content("This message contains an HTML Daily Operations Brief.")
        message.add_alternative(html, subtype="html")
        refused = client.send_message(message, from_addr=ACCOUNT, to_addrs=[args.to])
        if refused:
            raise RuntimeError("SMTP server refused the authorized recipient")

    print(json.dumps({
        "messageId": message_id.strip("<>"),
        "provider": "privateemail-smtp",
        "sender": ACCOUNT,
    }))


if __name__ == "__main__":
    main()
