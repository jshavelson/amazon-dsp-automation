#!/usr/bin/env python3
"""Single-use submission guard shared by module-specific portal adapters."""
from __future__ import annotations

import argparse
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path

from module_approval import atomic_json, verify_immutable_sources


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def mark_ready(state_path: Path, adapter: str) -> dict:
    state = load(state_path)
    if state["status"] == "submission_ready":
        return {"approval_id": state["approval_id"], "adapter": state["submission_adapter"], "status": state["status"]}
    if state["status"] != "approved" or not state.get("external_action_authorized"):
        raise RuntimeError(f"approval is not ready for submission: {state['status']}")
    verify_immutable_sources(state)
    if not adapter or not adapter.endswith(".mjs"):
        raise RuntimeError("a module-specific .mjs portal adapter is required")
    state["submission_adapter"] = adapter
    state["status"] = "submission_ready"
    state["events"].append({"at": now(), "event": "submission_intent_created", "adapter": adapter})
    atomic_json(state_path, state)
    return {"approval_id": state["approval_id"], "adapter": adapter, "status": state["status"]}


def claim(state_path: Path, adapter: str) -> dict:
    state = load(state_path)
    if state["status"] != "submission_ready" or state.get("submission_adapter") != adapter:
        raise RuntimeError("submission is not ready for this adapter")
    verify_immutable_sources(state)
    token = secrets.token_urlsafe(24)
    state["status"] = "submitting"
    state["submission"] = {"claimed_at": now(), "claim_token": token, "adapter": adapter}
    state["events"].append({"at": state["submission"]["claimed_at"], "event": "submission_claimed", "adapter": adapter})
    atomic_json(state_path, state)
    return {"approval_id": state["approval_id"], "claim_token": token, "status": state["status"]}


def finish(state_path: Path, token: str, outcome: str, confirmation: str | None) -> dict:
    state = load(state_path)
    if state["status"] != "submitting" or state.get("submission", {}).get("claim_token") != token:
        raise RuntimeError("submission claim does not match")
    if outcome == "submitted" and not confirmation:
        raise RuntimeError("submitted outcome requires portal confirmation")
    state["status"] = outcome
    state["submission"].update({"finished_at": now(), "outcome": outcome, "confirmation": confirmation})
    state["events"].append({"at": state["submission"]["finished_at"], "event": outcome, "confirmation": confirmation})
    atomic_json(state_path, state)
    return {"approval_id": state["approval_id"], "status": outcome, "confirmation": confirmation}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    ready = sub.add_parser("ready")
    ready.add_argument("--state", type=Path, required=True)
    ready.add_argument("--adapter", required=True)
    claim_parser = sub.add_parser("claim")
    claim_parser.add_argument("--state", type=Path, required=True)
    claim_parser.add_argument("--adapter", required=True)
    finish_parser = sub.add_parser("finish")
    finish_parser.add_argument("--state", type=Path, required=True)
    finish_parser.add_argument("--claim-token", required=True)
    finish_parser.add_argument("--outcome", choices=("submitted", "submission_unknown"), required=True)
    finish_parser.add_argument("--confirmation")
    args = parser.parse_args()
    state_path = args.state.resolve(strict=True)
    if args.command == "ready":
        result = mark_ready(state_path, args.adapter)
    elif args.command == "claim":
        result = claim(state_path, args.adapter)
    else:
        result = finish(state_path, args.claim_token, args.outcome, args.confirmation)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
