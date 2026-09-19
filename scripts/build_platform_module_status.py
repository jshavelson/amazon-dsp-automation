#!/usr/bin/env python3
"""Publish a PII-free status projection for the private platform preview."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from reconciliation_core import write_json_atomic


ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "platform" / "modules"
OUTPUT = ROOT / "platform" / "web" / "module-status.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def latest(pattern: str) -> Path | None:
    matches = list(ROOT.glob(pattern))
    return max(matches, key=lambda path: path.stat().st_mtime) if matches else None


def main() -> int:
    details: dict[str, dict] = {
        "fixed_monthly": {"state": "active", "headline": "Approval and guarded submission live", "detail": "Latest approved case submitted to Amazon."},
        "weekly_payments": {"state": "active", "headline": "Weekly invoice reconciliation live", "detail": "WST, variable invoice, and incentive invoice are compared."},
        "capacity_reliability": {"state": "active", "headline": "Route reconciliation live", "detail": "Amazon C&R is checked against route-coded WST executions."},
        "fif_reimbursements": {"state": "ready_for_import", "headline": "Reconciler ready", "detail": "Waiting for approved-claims and reimbursement-invoice exports."},
        "fifth_day_overtime": {"state": "ready_for_import", "headline": "Reconciler ready", "detail": "Waiting for route detail and payroll detail."},
        "next_mile_tuition": {"state": "ready_for_import", "headline": "Reconciler ready", "detail": "Waiting for InStride and payroll reimbursement exports."},
        "program_adjustments": {"state": "ready_for_import", "headline": "Reconciler ready", "detail": "Waiting for program support and invoice-adjustment exports."},
        "executive_dashboard": {"state": "active", "headline": "JECS dashboard available", "detail": "Current private dashboard remains linked from this site."},
        "data_integrations": {"state": "foundation", "headline": "Vault contract implemented", "detail": "Production OIDC, database, and cloud secret infrastructure remain deployment work."},
    }
    weekly = latest("data/payment_reconciliation/*/week*-module-case.json")
    if weekly:
        case = load(weekly)
        details["weekly_payments"].update({
            "last_case": case.get("external_key"),
            "case_status": case.get("status"),
            "candidate_count": case.get("candidate_count", 0),
            "recovered_routes": case.get("recovered_routes", 0),
            "recovered_value": case.get("recovered_value", 0),
        })
        if case.get("recovered_value"):
            details["weekly_payments"].update({
                "headline": "Weekly recovery confirmed",
                "detail": f"WST and invoice evidence confirm ${float(case['recovered_value']):,.2f} recovered.",
            })
    capacity = latest("data/payment_reconciliation/*/week*-capacity-reliability-case.json")
    if capacity:
        case = load(capacity)
        summary = case.get("summary", {})
        details["capacity_reliability"].update({
            "last_case": case.get("external_key"), "case_status": case.get("status"), "candidate_count": case.get("candidate_count", 0),
            "verified_routes": summary.get("amazon_completed_routes"),
        })
    approval = latest("data/fleet_reviews/fixed-monthly/approval-queue/*/approval.json")
    if approval:
        case = load(approval)
        details["fixed_monthly"].update({"last_case": case.get("approval_id"), "case_status": case.get("status"), "candidate_count": 1})
    modules = []
    for manifest_path in sorted(MODULES.glob("*/module.json")):
        manifest = load(manifest_path)
        modules.append({
            "id": manifest["id"], "display_name": manifest["displayName"], "billing_sku": manifest["billingSku"],
            "implementation_status": manifest["status"], **details.get(manifest["id"], {}),
        })
    write_json_atomic(OUTPUT, {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tenant": "JEC Logistics Solutions", "modules": modules,
        "security": {"credentials_rendered": False, "employee_level_data_rendered": False, "non_sensitive_status_only": True},
    })
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
