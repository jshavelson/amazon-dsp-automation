#!/usr/bin/env python3
"""Poll approval replies, submit newly approved disputes, and send receipts."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from fixed_monthly_approval import DEFAULT_QUEUE
from send_fixed_monthly_result import send as send_result


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> dict:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    return json.loads(result.stdout.strip().splitlines()[-1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    queue = args.queue.resolve()
    result = {"reply_check": None, "submissions": [], "notifications": []}
    if not args.dry_run:
        result["reply_check"] = run([
            sys.executable, "scripts/monitor_fixed_monthly_approval_replies.py", "--queue", str(queue),
        ])
    for state_path in sorted(queue.glob("*/approval.json")) if queue.exists() else []:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state["status"] in {"approved", "submission_ready"}:
            if args.dry_run:
                result["submissions"].append({"approval_id": state["approval_id"], "would_submit": True})
            else:
                try:
                    run(["node", "scripts/amazon_payments_session_check.mjs"])
                    result["submissions"].append(run([
                        "node", "scripts/submit_fixed_monthly_dispute.mjs", "--state", str(state_path), "--execute",
                    ]))
                except Exception as error:
                    result["submissions"].append({"approval_id": state["approval_id"], "error": str(error)})
        refreshed = json.loads(state_path.read_text(encoding="utf-8"))
        if refreshed["status"] in {"submitted", "submission_unknown"} and not refreshed.get("result_email"):
            try:
                result["notifications"].append(send_result(state_path, dry_run=args.dry_run))
            except Exception as error:
                result["notifications"].append({"approval_id": refreshed["approval_id"], "error": str(error)})
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
