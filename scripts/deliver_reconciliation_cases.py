#!/usr/bin/env python3
"""Prepare and send each newly generated non-Fixed-Monthly review once."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from module_approval import DEFAULT_QUEUE, prepare
from send_module_review import send


ROOT = Path(__file__).resolve().parents[1]
PATTERNS = (
    "data/payment_reconciliation/2026-wk*/week*-module-case.json",
    "data/payment_reconciliation/2026-wk*/week*-capacity-reliability-case.json",
    "data/module_cases/fif_reimbursements/*.json",
    "data/module_cases/fifth_day_overtime/*.json",
    "data/module_cases/next_mile_tuition/*.json",
    "data/module_cases/program_adjustments/*.json",
)


def latest_cases() -> list[Path]:
    result = []
    for pattern in PATTERNS:
        matches = list(ROOT.glob(pattern))
        if matches:
            result.append(max(matches, key=lambda path: path.stat().st_mtime))
    return result


def deliver(dry_run: bool = False, queue: Path = DEFAULT_QUEUE) -> dict:
    outcomes = []
    for case_path in latest_cases():
        case = json.loads(case_path.read_text(encoding="utf-8"))
        if case.get("status") not in {"closed", "approval_required"} or case.get("blocking_evidence"):
            outcomes.append({"module_id": case.get("module_id"), "external_key": case.get("external_key"), "status": "not_sendable"})
            continue
        state_path, _state = prepare(case_path, queue)
        outcomes.append({"module_id": case["module_id"], "external_key": case["external_key"], **send(state_path, dry_run=dry_run)})
    return {"dry_run": dry_run, "case_count": len(outcomes), "outcomes": outcomes}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    args = parser.parse_args()
    print(json.dumps(deliver(args.dry_run, args.queue.resolve())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
