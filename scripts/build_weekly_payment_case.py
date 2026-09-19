#!/usr/bin/env python3
"""Turn one weekly payment reconciliation into a module-scoped review case.

This classifies discrepancies but never submits a dispute or marks an invoice
reviewed. Underpayment findings remain needs_evidence until Scheduling/ADP and
the relevant operational source are attached.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


NUMBER = re.compile(r"WST\s+([\d,.]+);\s+Amazon invoice\s+([\d,.]+)", re.I)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(value: str) -> float:
    return float(value.replace(",", ""))


def classify(check: dict) -> dict:
    finding = {
        "check": check["check"],
        "status": check["status"],
        "detail": check["detail"],
        "direction": check.get("direction") or ("none" if check["status"] == "pass" else "unresolved"),
        "dispute_candidate": False,
    }
    for key in ("recovered_routes", "recovered_amount"):
        if key in check:
            finding[key] = check[key]
    if finding["direction"] == "recovered_before_review":
        return finding
    match = NUMBER.search(check.get("detail", ""))
    if not match:
        return finding
    our_value, amazon_value = map(number, match.groups())
    finding.update({"our_value": our_value, "amazon_value": amazon_value, "difference": amazon_value - our_value})
    if amazon_value < our_value:
        finding.update({"direction": "potential_underpayment", "dispute_candidate": True})
    elif amazon_value > our_value:
        finding["direction"] = "amazon_above_wst"
    else:
        finding["direction"] = "matched"
    return finding


def build_case(report: dict, evidence_hash: str, source_path: str) -> dict:
    findings = [classify(check) for check in report.get("checks", [])]
    candidates = [finding for finding in findings if finding["dispute_candidate"]]
    unresolved = [finding for finding in findings if finding["status"] != "pass"]
    recovered = [finding for finding in findings if finding["direction"] == "recovered_before_review"]
    snapshot_recovered_routes = sum(
        float(item.get("recovered_routes", 0)) for item in recovered if item["check"].startswith("WST snapshot change:")
    )
    reported_recovered_routes = sum(
        float(item.get("recovered_routes", 0)) for item in recovered if item["check"] == "Reported WST recovery outcome"
    )
    if candidates:
        status = "needs_evidence"
        disposition = "potential_underpayment"
    elif recovered:
        status = "closed"
        disposition = "recovery_confirmed"
    elif unresolved:
        status = "closed"
        disposition = "no_underpayment_detected"
    else:
        status = "closed"
        disposition = "reconciled"
    return {
        "schema_version": 1,
        "module_id": "weekly_payments",
        "tenant_id": "jecs",
        "external_key": f"{int(report['year'])}-W{int(report['week']):02d}",
        "status": status,
        "disposition": disposition,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dsp": report["dsp"],
        "station": report["station"],
        "evidence": [
            {"type": "weekly_reconciliation", "path": source_path, "sha256": evidence_hash},
            *report.get("source_evidence", []),
        ],
        "findings": findings,
        "candidate_count": len(candidates),
        "recovered_routes": max(snapshot_recovered_routes, reported_recovered_routes),
        "recovered_value": sum(float(item.get("recovered_amount", 0)) for item in recovered),
        "blocking_evidence": ([
            "Scheduling roster for the reviewed week",
            "ADP time records for the reviewed week",
            "Operational proof for each potentially unpaid route, training, or package event",
        ] if candidates else []),
        "external_action_authorized": False,
        "approval": None,
        "submission": None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reconciliation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.reconciliation.resolve(strict=True)
    report = json.loads(source.read_text(encoding="utf-8"))
    case = build_case(report, sha256(source), str(source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        try:
            existing = json.loads(args.output.read_text(encoding="utf-8"))
            old_compare = {key: value for key, value in existing.items() if key != "created_at"}
            new_compare = {key: value for key, value in case.items() if key != "created_at"}
            if old_compare == new_compare:
                case["created_at"] = existing.get("created_at", case["created_at"])
        except (OSError, json.JSONDecodeError):
            pass
    args.output.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "status": case["status"], "candidate_count": case["candidate_count"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
