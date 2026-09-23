#!/usr/bin/env python3
"""Export reviewed local operational payloads for the AWS React application.

The production container cannot access workstation evidence files or the local
Python API.  This exporter materializes the same reconciled, read-only payloads
inside ``platform/operational-snapshots`` before the canonical deployment
bundle is assembled.  Secret values are never included.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.financial_ingest import PROVIDER_LABELS, load_vendor_rules
from scripts.jecs_api_server import (
    build_connections_payload,
    build_fleet_compliance_payload,
    build_fleet_cost_reconciliation,
    build_performance_dashboard_payload,
    build_route_monitor_payload,
    build_reimbursement_review_payload,
)
from scripts.weekly_evaluation_snapshot import build_weekly_evaluations_payload


OUTPUT = ROOT / "platform/operational-snapshots"
TENANT = "jecs"


def write(name, payload):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / name
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    path.chmod(0o644)
    return path


def main():
    files = [
        write("performance.json", build_performance_dashboard_payload()),
        write("fleet-compliance.json", build_fleet_compliance_payload()),
        write("fleet-costs.json", build_fleet_cost_reconciliation(TENANT)),
        write("connections.json", build_connections_payload(TENANT)),
        write("vendor-rules.json", {
            "tenant": TENANT,
            "rules": load_vendor_rules(TENANT),
            "providers": PROVIDER_LABELS,
        }),
        write("modules.json", build_reimbursement_review_payload()),
        write("route-monitor.json", build_route_monitor_payload()),
        write("weekly-evaluations.json", build_weekly_evaluations_payload()),
    ]
    for path in files:
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
