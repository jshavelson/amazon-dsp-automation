#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from openpyxl import load_workbook
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE_HEADING = re.compile(
    rf"^(?P<month>{MONTHS}) (?P<day>\d{{1,2}}), (?P<year>\d{{4}}) \(Week (?P<week>\d{{1,2}})\)",
    re.MULTILINE,
)
CATEGORIES = {
    "amazon_owned_cdv_element": "Branded Custom Delivery Van (Element - Amazon Owned)",
    "amazon_owned_cdv_wheels": "Branded Custom Delivery Van (Wheels - Amazon Owned)",
    "amazon_owned_extended_element": "Branded Extended Van (Element - Amazon Owned)",
    "amazon_owned_extended_wheels": "Branded Extended Van (Wheels - Amazon Owned)",
    "amazon_lmr": "Branded Last Mile Rental Van",
    "amazon_owned_edv": "Branded Rivian Electric Vehicle (Element - Amazon Owned)",
    "dsp_lease": "DSP Leased Van",
    "third_party_rental": "Rental Van",
    "standard_rate": "Standard Rate Prepayment - Cargo Van",
}
AMAZON_OWNED_KEYS = {
    "amazon_owned_cdv_element",
    "amazon_owned_cdv_wheels",
    "amazon_owned_extended_element",
    "amazon_owned_extended_wheels",
    "amazon_owned_edv",
}
GAP_FILL_KEYS = {"amazon_lmr", "dsp_lease", "third_party_rental", "standard_rate"}


def money(value: Decimal) -> str:
    return f"${value:,.2f}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def flexible_pattern(description: str) -> str:
    return re.escape(description).replace(r"\ ", r"\s+")


def parse_invoice_pdf(path: Path) -> dict[str, object]:
    text = "\n".join((page.extract_text() or "") for page in PdfReader(path).pages)
    invoice_number = re.search(r"Invoice Number:\s*(\S+)", text)
    invoice_date = re.search(r"Invoice Date:\s*([A-Za-z]+ \d{1,2}, \d{4})", text)
    period = re.search(
        r"For services and costs incurred during ([A-Za-z]+ \d{4}).*?Starting:\s*(\w+ \d{2}, \d{4}).*?Ending:\s*(\w+ \d{2}, \d{4})",
        text,
        re.DOTALL,
    )
    if not invoice_number or not invoice_date or not period:
        raise ValueError("Could not parse invoice header and service period")

    headings = list(DATE_HEADING.finditer(text))
    days = []
    for index, heading in enumerate(headings):
        segment_end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        segment = text[heading.end():segment_end]
        day_value = datetime.strptime(
            f"{heading.group('month')} {heading.group('day')}, {heading.group('year')}", "%B %d, %Y"
        ).date()
        classes: dict[str, dict[str, str]] = {}
        for key, description in CATEGORIES.items():
            description_pattern = flexible_pattern(description)
            if key == "third_party_rental":
                description_pattern = r"(?<!Last\sMile\s)Rental\s+Van"
            match = re.search(
                rf"{description_pattern}\s+Cargo\s+Van\s+(\d+(?:\.\d+)?)\s+\$([\d,]+(?:\.\d+)?)\s+\$([\d,]+(?:\.\d+)?)",
                segment,
                re.DOTALL,
            )
            if not match:
                continue
            classes[key] = {
                "description": description,
                "quantity": str(Decimal(match.group(1))),
                "monthly_rate": str(Decimal(match.group(2).replace(",", ""))),
                "amount": str(Decimal(match.group(3).replace(",", ""))),
            }
        if not classes:
            raise ValueError(f"No vehicle classes parsed for {day_value}")
        days.append({
            "date": day_value.isoformat(),
            "week": int(heading.group("week")),
            "classes": classes,
        })

    if not days:
        raise ValueError("No daily invoice detail was parsed")
    return {
        "invoice_number": invoice_number.group(1),
        "invoice_date": datetime.strptime(invoice_date.group(1), "%B %d, %Y").date().isoformat(),
        "service_month": period.group(1),
        "service_start": datetime.strptime(period.group(2), "%B %d, %Y").date().isoformat(),
        "service_end": datetime.strptime(period.group(3), "%B %d, %Y").date().isoformat(),
        "days": days,
    }


def load_afs(afs_dir: Path, weeks: set[int]) -> dict[int, int]:
    values = {}
    for week in sorted(weeks):
        path = afs_dir / f"week{week:02d}-afs-summary.json"
        if not path.exists():
            raise ValueError(f"Missing AFS snapshot for W{week}: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        value = payload.get("CARGO_VAN", {}).get("totalAFS")
        if value is None:
            raise ValueError(f"Cargo Van totalAFS missing for W{week}: {path}")
        values[week] = int(value)
    return values


def wst_max_routes(wst_root: Path, week: int, covered_dates: set[str]) -> int | None:
    week_dir = wst_root / f"2026-wk{week:02d}" / "wst"
    daily_counts = []
    for day_value in sorted(covered_dates):
        path = week_dir / f"{day_value}-worksheets.json"
        if not path.exists():
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        count = sum(
            row.get("type") == "WORK_ORDER"
            and not row.get("suppressed")
            and "On-Road Experience" not in (row.get("serviceTypeName") or "")
            for row in rows
        )
        daily_counts.append(count)
    return max(daily_counts) if daily_counts else None


def capacity_max_completed(capacity_root: Path, week: int, covered_dates: set[str]) -> int | None:
    matches = list((capacity_root / f"2026-wk{week:02d}").glob("*Capacity-Reliability*.xlsx"))
    if not matches:
        return None
    workbook = load_workbook(matches[0], read_only=True, data_only=True)
    try:
        worksheet = workbook.active
        values = []
        for row in worksheet.iter_rows(min_row=27, max_row=33, values_only=True):
            if str(row[0]) not in covered_dates:
                continue
            if isinstance(row[5], (int, float)):
                values.append(int(row[5]))
        return max(values) if values else None
    finally:
        workbook.close()


def quantity(day: dict[str, object], key: str) -> int:
    value = day["classes"].get(key, {}).get("quantity", "0")
    return int(Decimal(value))


def amount(day: dict[str, object], key: str) -> Decimal:
    value = day["classes"].get(key, {}).get("amount", "0")
    return Decimal(value)


def analyze(invoice: dict[str, object], afs: dict[int, int], wst_root: Path, capacity_root: Path) -> dict[str, object]:
    week_dates: defaultdict[int, set[str]] = defaultdict(set)
    daily = []
    for item in invoice["days"]:
        week = int(item["week"])
        week_dates[week].add(item["date"])
        owned = sum(quantity(item, key) for key in AMAZON_OWNED_KEYS)
        lmr = quantity(item, "amazon_lmr")
        other_fill = sum(quantity(item, key) for key in GAP_FILL_KEYS - {"amazon_lmr"})
        paid_total = owned + lmr + other_fill
        target = afs[week]
        expected_lmr = max(0, target - owned - other_fill)
        daily.append({
            **item,
            "afs_target": target,
            "amazon_owned_paid": owned,
            "amazon_lmr_paid": lmr,
            "other_gap_fill_paid": other_fill,
            "paid_total": paid_total,
            "total_shortage": max(0, target - paid_total),
            "lmr_target": expected_lmr,
            "lmr_shortage": max(0, expected_lmr - lmr),
        })

    weekly = []
    for week in sorted(week_dates):
        covered = week_dates[week]
        rows = [item for item in daily if item["week"] == week]
        shortage_dates = [item["date"] for item in rows if item["total_shortage"] > 0]
        # Rebuild the expected rounded daily LMR line from the stated monthly rate,
        # then subtract the invoice's actual rounded line.
        estimated_lmr_due = Decimal("0")
        for item in rows:
            if not item["lmr_shortage"]:
                continue
            paid_amount = amount(item, "amazon_lmr")
            monthly_rate = Decimal(item["classes"].get("amazon_lmr", {}).get("monthly_rate", "0"))
            day_value = date.fromisoformat(item["date"])
            days_in_month = Decimal(monthrange(day_value.year, day_value.month)[1])
            expected_amount = (monthly_rate / days_in_month * item["lmr_target"]).quantize(Decimal("0.01"))
            estimated_lmr_due += expected_amount - paid_amount
        weekly.append({
            "week": week,
            "covered_dates": sorted(covered),
            "afs_target": afs[week],
            "minimum_paid_total": min(item["paid_total"] for item in rows),
            "maximum_paid_total": max(item["paid_total"] for item in rows),
            "wst_max_standard_routes": wst_max_routes(wst_root, week, covered),
            "capacity_max_completed_routes": capacity_max_completed(capacity_root, week, covered),
            "shortage_dates": shortage_dates,
            "maximum_daily_shortage": max(item["total_shortage"] for item in rows),
            "estimated_lmr_due": str(estimated_lmr_due.quantize(Decimal("0.01"))),
            "status": "review" if shortage_dates else "pass",
        })

    groups = []
    current = None
    for item in daily:
        signature = (
            item["week"], item["afs_target"], item["amazon_owned_paid"], item["amazon_lmr_paid"],
            item["other_gap_fill_paid"], item["paid_total"], item["total_shortage"], item["lmr_target"],
        )
        if current and current["signature"] == signature and (
            date.fromisoformat(item["date"]) - date.fromisoformat(current["end_date"])
        ).days == 1:
            current["end_date"] = item["date"]
            current["days"] += 1
        else:
            current = {
                "signature": signature,
                "week": item["week"],
                "start_date": item["date"],
                "end_date": item["date"],
                "days": 1,
                "afs_target": item["afs_target"],
                "amazon_owned_paid": item["amazon_owned_paid"],
                "amazon_lmr_paid": item["amazon_lmr_paid"],
                "other_gap_fill_paid": item["other_gap_fill_paid"],
                "paid_total": item["paid_total"],
                "total_shortage": item["total_shortage"],
                "lmr_target": item["lmr_target"],
            }
            groups.append(current)
    for group in groups:
        group.pop("signature", None)

    return {"daily": daily, "weekly": weekly, "contiguous_paid_mix": groups}


def render_markdown(report: dict[str, object]) -> str:
    invoice = report["invoice"]
    lines = [
        "# Fixed Monthly Fleet Entitlement Review",
        "",
        f"**Invoice:** {invoice['invoice_number']}  ",
        f"**Service period:** {invoice['service_start']} to {invoice['service_end']}  ",
        f"**Prepared:** {report['prepared_at']}  ",
        "",
        "## Decision Summary",
        "",
    ]
    reviews = [row for row in report["analysis"]["weekly"] if row["status"] == "review"]
    if reviews:
        for row in reviews:
            lines.append(
                f"- **W{row['week']} requires review:** AFS was **{row['afs_target']}**, paid fleet fell to "
                f"**{row['minimum_paid_total']}**, and the maximum daily shortage was **{row['maximum_daily_shortage']}** vehicle(s). "
                f"Estimated LMR value for the covered shortage dates: **{money(Decimal(row['estimated_lmr_due']))}**."
            )
    else:
        lines.append("- No AFS-versus-paid-fleet shortage was found for the invoice period.")
    lines.extend([
        "",
        "## Weekly Review",
        "",
        "| Week | Invoice dates reviewed | AFS | Paid fleet range | WST max standard routes | C&R max completed | Result |",
        "|---|---|---:|---:|---:|---:|---|",
    ])
    for row in report["analysis"]["weekly"]:
        paid_range = str(row["minimum_paid_total"]) if row["minimum_paid_total"] == row["maximum_paid_total"] else f"{row['minimum_paid_total']}–{row['maximum_paid_total']}"
        lines.append(
            f"| W{row['week']} | {row['covered_dates'][0]} to {row['covered_dates'][-1]} | {row['afs_target']} | {paid_range} | "
            f"{row['wst_max_standard_routes'] if row['wst_max_standard_routes'] is not None else 'Unavailable'} | "
            f"{row['capacity_max_completed_routes'] if row['capacity_max_completed_routes'] is not None else 'Unavailable'} | {row['status'].upper()} |"
        )
    lines.extend([
        "",
        "## Paid Fleet Mix by Date Range",
        "",
        "| Week | Dates | AFS | Amazon-owned | LMR paid / target | Other gap-fill | Total paid | Shortage |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ])
    for row in report["analysis"]["contiguous_paid_mix"]:
        dates = row["start_date"] if row["start_date"] == row["end_date"] else f"{row['start_date']} to {row['end_date']}"
        lines.append(
            f"| W{row['week']} | {dates} | {row['afs_target']} | {row['amazon_owned_paid']} | "
            f"{row['amazon_lmr_paid']} / {row['lmr_target']} | {row['other_gap_fill_paid']} | {row['paid_total']} | {row['total_shortage']} |"
        )
    lines.extend([
        "",
        "## Recommended Review Wording",
        "",
        "Amazon's final Fixed Monthly reconciliation should be reviewed for each date where paid fleet is below the verified Cargo Van AFS. For W36, the invoice paid 25 Amazon-owned vehicles and 12 LMR vehicles on August 30–31, totaling 37 against AFS 39. Review entitlement to two additional LMR vehicles for both dates. Preserve the final invoice, historical AFS API snapshots, Fleet Portal classifications, and route evidence before filing.",
        "",
        "## Guardrails",
        "",
        "- This report identifies review candidates; it does not submit a dispute or mark an invoice reviewed.",
        "- AFS is sourced from Amazon Fleet Management, not inferred from paid quantities.",
        "- WST route evidence excludes suppressed work orders and On-Road Experience blocks.",
        "- C&R completed-route counts are retained as a secondary comparison because their scope can differ from WST.",
        "- Estimated dollars use the invoice's rounded daily LMR line value and must be confirmed against Amazon's dispute calculation.",
        "",
        "## Source Evidence",
        "",
        f"- Final invoice PDF: `{report['sources']['invoice_pdf']}`",
        f"- Historical AFS snapshots: `{report['sources']['afs_dir']}`",
        f"- WST snapshots: `{report['sources']['wst_root']}`",
        f"- Capacity Reliability reports: `{report['sources']['capacity_root']}`",
    ])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile Amazon Fixed Monthly fleet payments to historical AFS.")
    parser.add_argument("--invoice-pdf", type=Path, required=True)
    parser.add_argument("--afs-dir", type=Path, required=True)
    parser.add_argument("--wst-root", type=Path, default=ROOT / "data/payment_reconciliation")
    parser.add_argument("--capacity-root", type=Path, default=ROOT / "data/scorecard_data")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    invoice = parse_invoice_pdf(args.invoice_pdf)
    weeks = {int(item["week"]) for item in invoice["days"]}
    afs = load_afs(args.afs_dir, weeks)
    analysis = analyze(invoice, afs, args.wst_root, args.capacity_root)
    report = {
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "invoice": invoice,
        "analysis": analysis,
        "sources": {
            "invoice_pdf": str(args.invoice_pdf),
            "invoice_sha256": sha256(args.invoice_pdf),
            "afs_dir": str(args.afs_dir),
            "wst_root": str(args.wst_root),
            "capacity_root": str(args.capacity_root),
        },
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "fixed-monthly-entitlement-review.json"
    markdown_path = args.output_dir / "fixed-monthly-entitlement-review.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    print(markdown_path)
    print(json_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
