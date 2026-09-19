#!/usr/bin/env python3
"""Apply exact same-thread YES/NO decisions to generic module approvals."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from module_approval import AUTHORIZED_RECIPIENT, DEFAULT_QUEUE, apply_decision
from monitor_fixed_monthly_approval_replies import exact_decision, read_fixture, read_imap


def load_states(queue: Path) -> list[tuple[Path, dict]]:
    result = []
    for state_path in sorted(queue.glob("*/*/approval.json")) if queue.exists() else []:
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
            if AUTHORIZED_RECIPIENT not in item["from_addresses"] or item["message_id"].strip("<>") == original:
                continue
            if original not in f"{item['in_reply_to']} {item['references']}":
                continue
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
                "decision": decision, "from": AUTHORIZED_RECIPIENT, "received_at": item["received_at"],
                "reply_message_id": item["message_id"], "reply_sha256": item["raw_sha256"],
                "original_message_id": original,
            })
            outcomes.append({"approval_id": state["approval_id"], "status": updated["status"], "reply_message_id": item["message_id"]})
            applied = True
            break
        if matches and not applied:
            outcomes.append({"approval_id": state["approval_id"], "status": "ambiguous_reply_ignored", "matches": len(matches)})
    return outcomes


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
