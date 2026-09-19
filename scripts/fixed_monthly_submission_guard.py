#!/usr/bin/env python3
"""Single-use state guard around an externally approved Amazon submission."""
from __future__ import annotations

import argparse
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path

from fixed_monthly_approval import atomic_json, verify_immutable_sources


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def intent(state_path: Path) -> dict:
    state = load(state_path)
    if state["status"] not in {"approved", "submission_ready"}:
        raise RuntimeError(f"approval is not ready for submission: {state['status']}")
    verify_immutable_sources(state)
    candidate = state.get("candidate")
    if not candidate:
        raise RuntimeError("approval has no dispute candidate")
    return {
        "approval_id": state["approval_id"],
        "invoice_number": state["invoice"]["invoice_number"],
        "report_sha256": state["report"]["sha256"],
        "candidate": candidate,
        "authorized_by": state["decision"]["from"],
        "authorized_at": state["decision"]["received_at"],
        "reply_message_id": state["decision"]["reply_message_id"],
    }


def mark_ready(state_path: Path) -> dict:
    state = load(state_path)
    if state["status"] == "submission_ready":
        return intent(state_path)
    payload = intent(state_path)
    state["status"] = "submission_ready"
    state["events"].append({"at": now(), "event": "submission_intent_created"})
    atomic_json(state_path, state)
    return payload


def claim(state_path: Path) -> dict:
    state = load(state_path)
    if state["status"] != "submission_ready":
        raise RuntimeError(f"submission is not ready to claim: {state['status']}")
    verify_immutable_sources(state)
    token = secrets.token_urlsafe(24)
    state["status"] = "submitting"
    state["submission"] = {"claimed_at": now(), "claim_token": token}
    state["events"].append({"at": state["submission"]["claimed_at"], "event": "submission_claimed"})
    atomic_json(state_path, state)
    return {"approval_id": state["approval_id"], "claim_token": token, "status": "submitting"}


def finish(state_path: Path, token: str, outcome: str, confirmation: str | None) -> dict:
    state = load(state_path)
    if state["status"] != "submitting" or state.get("submission", {}).get("claim_token") != token:
        raise RuntimeError("submission claim does not match")
    if outcome == "submitted" and not confirmation:
        raise RuntimeError("submitted outcome requires a portal confirmation")
    state["status"] = outcome
    state["submission"].update({"finished_at": now(), "outcome": outcome, "confirmation": confirmation})
    state["events"].append({"at": state["submission"]["finished_at"], "event": outcome, "confirmation": confirmation})
    atomic_json(state_path, state)
    return {"approval_id": state["approval_id"], "status": outcome, "confirmation": confirmation}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("intent", "ready", "claim"):
        child = sub.add_parser(name)
        child.add_argument("--state", type=Path, required=True)
    finish_parser = sub.add_parser("finish")
    finish_parser.add_argument("--state", type=Path, required=True)
    finish_parser.add_argument("--claim-token", required=True)
    finish_parser.add_argument("--outcome", choices=("submitted", "submission_unknown"), required=True)
    finish_parser.add_argument("--confirmation")
    args = parser.parse_args()
    state_path = args.state.resolve(strict=True)
    if args.command == "intent":
        result = intent(state_path)
    elif args.command == "ready":
        result = mark_ready(state_path)
    elif args.command == "claim":
        result = claim(state_path)
    else:
        result = finish(state_path, args.claim_token, args.outcome, args.confirmation)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
