#!/usr/bin/env python3
"""Prepare and update approval records for Fixed Monthly invoice disputes.

This module never sends mail and never submits an Amazon dispute. It creates a
tamper-evident approval record and can apply a previously parsed email decision.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_QUEUE = ROOT / "data/fleet_reviews/fixed-monthly/approval-queue"
AUTHORIZED_RECIPIENT = "jason@jeclogs.com"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def approval_id(report: dict, report_hash: str) -> str:
    invoice = re.sub(r"[^A-Z0-9]", "", report["invoice"]["invoice_number"].upper())[-12:]
    return f"FM-{invoice}-{report_hash[:10].upper()}"


def dispute_candidate(report: dict) -> dict | None:
    review_rows = [row for row in report["analysis"]["weekly"] if row["status"] == "review"]
    if not review_rows:
        return None
    dates = sorted({day for row in review_rows for day in row["shortage_dates"]})
    weeks = sorted({int(row["week"]) for row in review_rows})
    shortage = max(int(row["maximum_daily_shortage"]) for row in review_rows)
    estimated = sum((Decimal(row["estimated_lmr_due"]) for row in review_rows), Decimal("0"))
    facts = []
    daily_by_date = {row["date"]: row for row in report.get("analysis", {}).get("daily", [])}
    for row in review_rows:
        date_targets = []
        for day_value in row["shortage_dates"]:
            daily = daily_by_date.get(day_value)
            if daily is None:
                raise RuntimeError(f"daily entitlement evidence missing for {day_value}")
            date_targets.append({
                "date": day_value,
                "amazon_lmr_paid": int(daily["amazon_lmr_paid"]),
                "amazon_lmr_final_quantity": int(daily["lmr_target"]),
            })
        facts.append({
            "week": int(row["week"]),
            "afs_target": int(row["afs_target"]),
            "minimum_paid_total": int(row["minimum_paid_total"]),
            "maximum_daily_shortage": int(row["maximum_daily_shortage"]),
            "shortage_dates": list(row["shortage_dates"]),
            "estimated_lmr_due": str(Decimal(row["estimated_lmr_due"]).quantize(Decimal("0.01"))),
            "date_targets": date_targets,
        })
    wording = (
        f"Please review Fixed Monthly invoice {report['invoice']['invoice_number']} for W"
        f"{', W'.join(str(week) for week in weeks)}. Amazon's verified Cargo Van AFS exceeded the paid "
        f"fleet by up to {shortage} vehicle(s) on {', '.join(dates)}. The attached evidence identifies "
        f"the affected dates and paid fleet mix. Please reconcile the missing eligible LMR entitlement."
    )
    return {
        "candidate_id": "FIXED-MONTHLY-FLEET-ENTITLEMENT",
        "weeks": weeks,
        "dates": dates,
        "maximum_daily_shortage": shortage,
        "estimated_value": str(estimated.quantize(Decimal("0.01"))),
        "facts": facts,
        "proposed_wording": wording,
    }


def render_html(state: dict) -> str:
    invoice = state["invoice"]
    candidate = state.get("candidate")
    approval = state["approval_id"]
    title = "Fixed Monthly invoice review"
    if candidate:
        decision = (
            f'<div style="background:#fff4db;border:1px solid #e6a700;padding:16px;border-radius:8px">'
            f'<strong>Approval requested</strong><br>Reply with exactly <strong>YES</strong> in this email thread '
            f'to authorize filing the dispute described below. Reply <strong>NO</strong> to decline.<br>'
            f'<span style="color:#555">Approval ID: {html.escape(approval)}</span></div>'
        )
        facts = "".join(
            "<tr>"
            f"<td>W{row['week']}</td><td>{html.escape(', '.join(row['shortage_dates']))}</td>"
            f"<td>{row['afs_target']}</td><td>{row['minimum_paid_total']}</td>"
            f"<td>{row['maximum_daily_shortage']}</td><td>${Decimal(row['estimated_lmr_due']):,.2f}</td>"
            "</tr>"
            for row in candidate["facts"]
        )
        detail = f"""
        <h2>Dispute opportunity</h2>
        <table style="border-collapse:collapse;width:100%">
          <thead><tr><th>Week</th><th>Affected dates</th><th>AFS</th><th>Paid fleet</th><th>Shortage</th><th>Est. value</th></tr></thead>
          <tbody>{facts}</tbody>
        </table>
        <p><strong>Total estimated value:</strong> ${Decimal(candidate['estimated_value']):,.2f}</p>
        <h3>Proposed wording</h3><p>{html.escape(candidate['proposed_wording'])}</p>
        """
    else:
        decision = '<div style="background:#e9f7ef;border:1px solid #3a9d5d;padding:16px;border-radius:8px"><strong>No dispute identified.</strong> No reply is required.</div>'
        detail = ""
    style = """
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17212b;line-height:1.45;max-width:760px;margin:auto;padding:20px}
      h1{font-size:24px} h2{font-size:19px;margin-top:24px} h3{font-size:16px}
      th,td{border:1px solid #d9dee3;padding:8px;text-align:left;font-size:13px} th{background:#eef2f5}
      .muted{color:#5f6b76;font-size:13px}
    """
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{style}</style></head><body>
      <h1>{title}</h1>
      <p><strong>Invoice:</strong> {html.escape(invoice['invoice_number'])}<br>
      <strong>Service period:</strong> {html.escape(invoice['service_start'])} to {html.escape(invoice['service_end'])}</p>
      {decision}{detail}
      <h2>Evidence</h2>
      <p>The attached PDF contains the weekly AFS comparison, paid fleet mix, route context, source paths, and guardrails.</p>
      <p class="muted">A YES reply authorizes only this approval ID and this exact report hash. Any changed evidence requires a new approval email.</p>
    </body></html>"""


def prepare(report_path: Path, pdf_path: Path, queue_root: Path = DEFAULT_QUEUE) -> tuple[Path, dict]:
    report_path = report_path.resolve(strict=True)
    pdf_path = pdf_path.resolve(strict=True)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report_hash = sha256(report_path)
    identifier = approval_id(report, report_hash)
    directory = queue_root.resolve() / identifier
    state_path = directory / "approval.json"
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state["report"]["sha256"] != report_hash:
            raise RuntimeError("approval ID collision with a different report hash")
        return state_path, state
    candidate = dispute_candidate(report)
    state = {
        "version": 1,
        "approval_id": identifier,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "recipient": AUTHORIZED_RECIPIENT,
        "invoice": {
            key: report["invoice"][key]
            for key in ("invoice_number", "invoice_date", "service_month", "service_start", "service_end")
        },
        "report": {"path": str(report_path), "sha256": report_hash},
        "pdf": {"path": str(pdf_path), "sha256": sha256(pdf_path)},
        "source_invoice": {
            "path": str((ROOT / report["sources"]["invoice_pdf"]).resolve()) if not Path(report["sources"]["invoice_pdf"]).is_absolute() else report["sources"]["invoice_pdf"],
            "sha256": report["sources"]["invoice_sha256"],
        },
        "candidate": candidate,
        "status": "prepared" if candidate else "prepared_no_dispute",
        "approval_rule": "Exact YES or NO from jason@jeclogs.com in the original email thread; single use.",
        "events": [{"at": datetime.now(timezone.utc).isoformat(), "event": "prepared"}],
    }
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    html_path = directory / "review.html"
    html_path.write_text(render_html(state), encoding="utf-8")
    os.chmod(html_path, 0o600)
    atomic_json(state_path, state)
    return state_path, state


def verify_immutable_sources(state: dict) -> None:
    for key in ("report", "pdf", "source_invoice"):
        path = Path(state[key]["path"])
        if not path.exists() or sha256(path) != state[key]["sha256"]:
            raise RuntimeError(f"{key} source is missing or changed")


def apply_decision(state_path: Path, decision: dict) -> dict:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["status"] != "awaiting_approval":
        raise RuntimeError(f"approval is not awaiting a decision: {state['status']}")
    verify_immutable_sources(state)
    normalized = decision["decision"].strip().upper()
    if normalized not in {"YES", "NO"}:
        raise RuntimeError("decision must be exact YES or NO")
    if decision["from"].strip().lower() != AUTHORIZED_RECIPIENT:
        raise RuntimeError("decision sender is not authorized")
    if decision["original_message_id"].strip("<>") != state["sent"]["message_id"].strip("<>"):
        raise RuntimeError("decision is not tied to the sent approval email")
    if state.get("candidate") is None and normalized == "YES":
        raise RuntimeError("cannot approve when no dispute candidate exists")
    event = {
        "at": decision["received_at"],
        "event": "approved" if normalized == "YES" else "declined",
        "reply_message_id": decision["reply_message_id"],
        "reply_sha256": decision["reply_sha256"],
    }
    state["decision"] = {**decision, "decision": normalized}
    state["status"] = "approved" if normalized == "YES" else "declined"
    state["events"].append(event)
    atomic_json(state_path, state)
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("--report", type=Path, required=True)
    prepare_parser.add_argument("--pdf", type=Path, required=True)
    prepare_parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        state_path, state = prepare(args.report, args.pdf, args.queue)
        print(json.dumps({"state": str(state_path), "approval_id": state["approval_id"], "status": state["status"]}))
    else:
        state = json.loads(args.state.read_text(encoding="utf-8"))
        verify_immutable_sources(state)
        print(json.dumps({"verified": True, "approval_id": state["approval_id"], "status": state["status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
