#!/usr/bin/env python3
"""CLI for one of the four independently licensed import-driven modules."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from reconciliation_core import case_document, evidence, load_rows, write_json_atomic
from reconciliation_modules import adjustment_findings, fif_findings, fifth_day_findings, next_mile_findings


CONFIG = {
    "fif_reimbursements": ("approved_claims", "reimbursement_invoice", fif_findings),
    "fifth_day_overtime": ("route_detail", "payroll_detail", fifth_day_findings),
    "next_mile_tuition": ("instride_disbursements", "payroll_reimbursements", next_mile_findings),
    "program_adjustments": ("program_support", "invoice_adjustments", adjustment_findings),
}


def run(module_id: str, first: Path | None, second: Path | None, external_key: str, as_of: date) -> dict:
    first_type, second_type, reconciler = CONFIG[module_id]
    missing = [label for label, path in ((first_type, first), (second_type, second)) if path is None]
    if missing:
        evidence_items = [evidence(path, label) for label, path in ((first_type, first), (second_type, second)) if path is not None]
        return case_document(
            module_id=module_id,
            external_key=external_key,
            findings=[],
            evidence_items=evidence_items,
            blocking_evidence=[label.replace("_", " ") for label in missing],
        )
    first_rows, second_rows = load_rows(first), load_rows(second)
    if module_id == "next_mile_tuition":
        findings = reconciler(first_rows, second_rows, as_of)
    else:
        findings = reconciler(first_rows, second_rows)
    return case_document(
        module_id=module_id,
        external_key=external_key,
        findings=findings,
        evidence_items=[evidence(first, first_type), evidence(second, second_type)],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", choices=sorted(CONFIG), required=True)
    parser.add_argument("--first", type=Path)
    parser.add_argument("--second", type=Path)
    parser.add_argument("--external-key", required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    first = args.first.resolve(strict=True) if args.first else None
    second = args.second.resolve(strict=True) if args.second else None
    document = run(args.module, first, second, args.external_key, args.as_of)
    write_json_atomic(args.output, document)
    print(json.dumps({"output": str(args.output), "status": document["status"], "candidate_count": document["candidate_count"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
