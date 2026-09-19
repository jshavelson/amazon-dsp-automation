#!/usr/bin/env python3
"""Discover, reconcile, notify, and collect approvals for Fixed Monthly invoices."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

from fixed_monthly_approval import DEFAULT_QUEUE, prepare, sha256
from reconcile_fixed_monthly import parse_invoice_pdf
from send_fixed_monthly_review import send


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> str:
    try:
        result = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or str(error)).strip()
        raise RuntimeError(f"command failed: {' '.join(command)}: {detail}") from error
    return result.stdout.strip()


def discover() -> Path | None:
    run(["node", "scripts/amazon_payments_session_check.mjs"])
    output = run(["node", "scripts/amazon_fixed_monthly_download.mjs"])
    payload = json.loads(output.splitlines()[-1])
    return Path(payload["pdf"]) if payload.get("downloaded") else None


def reconcile(invoice_pdf: Path) -> tuple[Path, Path]:
    invoice = parse_invoice_pdf(invoice_pdf)
    start = date.fromisoformat(invoice["service_start"])
    service_dir = ROOT / "data/fleet_reviews/fixed-monthly" / start.strftime("%Y-%m")
    report = service_dir / "fixed-monthly-entitlement-review.json"
    pdf = service_dir / "fixed-monthly-entitlement-review.pdf"
    if report.exists() and pdf.exists():
        existing = json.loads(report.read_text(encoding="utf-8"))
        if (
            existing.get("invoice", {}).get("invoice_number") == invoice["invoice_number"]
            and existing.get("sources", {}).get("invoice_sha256") == sha256(invoice_pdf)
        ):
            return report, pdf
    afs_dir = service_dir / "afs"
    weeks = sorted({int(item["week"]) for item in invoice["days"]})
    iso_years = {date.fromisoformat(item["date"]).isocalendar().year for item in invoice["days"]}
    if len(iso_years) != 1:
        raise RuntimeError("service period spans ISO years; split AFS capture is required")
    missing_afs = [week for week in weeks if not (afs_dir / f"week{week:02d}-afs-summary.json").exists()]
    if missing_afs:
        run([
            "node", "scripts/amazon_afs_history_snapshot.mjs",
            "--year", str(iso_years.pop()), "--start-week", str(min(missing_afs)), "--end-week", str(max(missing_afs)),
            "--output-dir", str(afs_dir), "--storage-state", ".openclaw/amazon-payments-storage-state.json",
        ])
    run([
        sys.executable, "scripts/reconcile_fixed_monthly.py",
        "--invoice-pdf", str(invoice_pdf), "--afs-dir", str(afs_dir), "--output-dir", str(service_dir),
    ])
    markdown = service_dir / "fixed-monthly-entitlement-review.md"
    run([sys.executable, "scripts/render_markdown_to_pdf.py", str(markdown), str(pdf)])
    return report, pdf


def monitor_replies(queue: Path) -> dict:
    output = run([sys.executable, "scripts/monitor_fixed_monthly_approval_replies.py", "--queue", str(queue)])
    return json.loads(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--invoice-pdf", type=Path)
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-reply-check", action="store_true")
    args = parser.parse_args()
    queue = args.queue.resolve()
    invoice_pdf = args.invoice_pdf.resolve(strict=True) if args.invoice_pdf else discover()
    result: dict = {"new_invoice": bool(invoice_pdf)}
    if invoice_pdf:
        report, pdf = reconcile(invoice_pdf)
        state_path, state = prepare(report, pdf, queue)
        result.update({"invoice": state["invoice"]["invoice_number"], "approval_id": state["approval_id"], "state": str(state_path)})
        result["email"] = send(state_path, dry_run=args.dry_run)
    if not args.skip_reply_check and not args.dry_run:
        result["replies"] = monitor_replies(queue)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
