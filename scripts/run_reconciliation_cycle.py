#!/usr/bin/env python3
"""Daily idempotent source refresh, reconciliation, dashboard, and email cycle."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def amazon_week(day: dt.date) -> tuple[int, int]:
    shifted = day + dt.timedelta(days=1)
    iso = shifted.isocalendar()
    return iso.year, iso.week


def latest_completed_week(today: dt.date | None = None) -> tuple[int, int]:
    today = today or dt.date.today()
    days_since_saturday = (today.weekday() - 5) % 7
    if days_since_saturday == 0:
        days_since_saturday = 7
    return amazon_week(today - dt.timedelta(days=days_since_saturday))


def run(args: list[str]) -> str:
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    return result.stdout.strip()


def invoice_paths(manifest_path: Path) -> tuple[Path, Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    variable = incentive = None
    for item in manifest.get("files", []):
        summary = str(item.get("summary") or "").lower()
        destination = Path(item["destination"])
        if "variable invoice" in summary:
            variable = destination
        elif "incentive" in summary or ".inc." in str(item.get("href") or "").lower():
            incentive = destination
    if not variable or not incentive:
        raise RuntimeError("payment manifest does not identify variable and incentive invoices")
    return variable, incentive


def cycle(year: int, week: int, *, refresh: bool, send: bool) -> dict:
    week_key = f"{year}-wk{week:02d}"
    payment_dir = ROOT / "data/payment_reconciliation" / week_key
    scorecard_dir = ROOT / "data/scorecard_data" / week_key
    if refresh:
        run(["node", "scripts/amazon_session_check.mjs"])
        run(["node", "scripts/amazon_payments_session_check.mjs"])
        run(["node", "scripts/amazon_wst_snapshot.mjs", "--year", str(year), "--week", str(week)])
        run(["node", "scripts/amazon_payments_download.mjs", "--year", str(year), "--week", str(week)])
        scorecard_dir.mkdir(parents=True, exist_ok=True)
        run(["node", "scripts/amazon_logistics_download.mjs", "--week-folder", str(scorecard_dir.relative_to(ROOT)), "--supplementary-only", "true", "--allow-missing", "true"])

    manifest = payment_dir / "download-manifest.json"
    wst_summary = payment_dir / "wst/wst-summary.json"
    if not manifest.exists() or not wst_summary.exists():
        raise RuntimeError(f"WST or invoice evidence is unavailable for {week_key}")
    variable, incentive = invoice_paths(manifest)
    reconciliation_command = [
        sys.executable,
        "scripts/reconcile_payments.py",
        "--variable-pdf", str(variable),
        "--incentive-pdf", str(incentive),
        "--wst-summary", str(wst_summary),
        "--output-dir", str(payment_dir),
    ]
    snapshots = sorted((payment_dir / "wst/snapshots").glob("*-wst-summary.json"))
    if snapshots:
        reconciliation_command.extend(["--wst-baseline", str(snapshots[0])])
    for email_archive in sorted((ROOT / "data/email_inbox/owner").glob("*/jason@jeclogs.com.json")):
        reconciliation_command.extend(["--outcome-email-json", str(email_archive)])
    run(reconciliation_command)
    reconciliation = payment_dir / f"week{week}-invoice-reconciliation.json"
    weekly_case = payment_dir / f"week{week}-module-case.json"
    run([sys.executable, "scripts/build_weekly_payment_case.py", "--reconciliation", str(reconciliation), "--output", str(weekly_case)])

    capacity_files = sorted(scorecard_dir.glob("*Capacity-Reliability.xlsx"))
    capacity_case = None
    if capacity_files:
        capacity_case = payment_dir / f"week{week}-capacity-reliability-case.json"
        run([sys.executable, "scripts/reconcile_capacity_reliability.py", "--capacity-report", str(capacity_files[-1]), "--wst-dir", str(payment_dir / "wst"), "--year", str(year), "--week", str(week), "--output", str(capacity_case)])

    warnings = []
    try:
        run([sys.executable, "scripts/build_dsp_kpi_dashboard.py"])
        run(["zsh", "scripts/publish_platform_preview.sh"])
    except Exception as error:
        warnings.append(f"dashboard publication skipped: {error}")
    delivery = json.loads(run([sys.executable, "scripts/deliver_reconciliation_cases.py", *([] if send else ["--dry-run"])]))
    return {"week": week_key, "weekly_case": str(weekly_case), "capacity_case": str(capacity_case) if capacity_case else None, "warnings": warnings, "delivery": delivery}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int)
    parser.add_argument("--week", type=int)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()
    year, week = (args.year, args.week) if args.year and args.week else latest_completed_week()
    print(json.dumps(cycle(year, week, refresh=args.refresh, send=args.send)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
