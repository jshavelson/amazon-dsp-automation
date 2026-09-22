"""Parse tenant-supplied PAVE fleet assessment CSV exports."""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime

REQUIRED_HEADERS = {
    "VIN", "License Plate", "YMM", "Status", "Fleet Condition Grade",
    "Station", "Session Key", "Fleet Condition Score", "Has New Damage",
    "Grounding Risk", "Created At",
}


def _date(value: str) -> datetime:
    return datetime.strptime((value or "").strip(), "%d/%m/%Y, %H:%M:%S")


def parse_pave_export(payload: bytes, filename: str) -> dict:
    if not filename.lower().endswith(".csv"):
        return {"ok": False, "error": "PAVE upload must be a CSV export."}
    try:
        text = payload.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        headers = set(reader.fieldnames or [])
        missing = sorted(REQUIRED_HEADERS - headers)
        if missing:
            return {"ok": False, "error": f"Missing PAVE columns: {', '.join(missing)}"}
        raw_rows = list(reader)
    except (UnicodeDecodeError, csv.Error) as error:
        return {"ok": False, "error": f"Unreadable PAVE CSV: {error}"}

    rows, rejected = [], []
    for index, row in enumerate(raw_rows, start=2):
        try:
            created = _date(row.get("Created At", ""))
        except ValueError:
            rejected.append({"row": index, "reason": "invalid Created At"})
            continue
        grade_text = (row.get("Fleet Condition Grade") or "").strip()
        try:
            grade = int(grade_text.split("-", 1)[0]) if grade_text else None
            score = int(row.get("Fleet Condition Score") or 0)
        except ValueError:
            rejected.append({"row": index, "reason": "invalid grade or score"})
            continue
        vin = (row.get("VIN") or "").strip().upper()
        status = (row.get("Status") or "").strip()
        normalized = {
            "vin": vin,
            "licensePlate": (row.get("License Plate") or "").strip(),
            "ymm": (row.get("YMM") or "").strip(),
            "status": status,
            "gradeLabel": grade_text,
            "grade": grade,
            "station": (row.get("Station") or "").strip(),
            "sessionKey": (row.get("Session Key") or "").strip(),
            "conditionScore": score,
            "hasNewDamage": (row.get("Has New Damage") or "").strip().lower() == "yes",
            "groundingRisk": (row.get("Grounding Risk") or "").strip().lower() == "yes",
            "createdAt": created.isoformat(),
        }
        rows.append(normalized)

    eligible = [row for row in rows if row["status"].lower() == "completed" and row["vin"]]
    latest_by_vin = {}
    for row in sorted(eligible, key=lambda item: item["createdAt"]):
        latest_by_vin[row["vin"]] = row
    latest = sorted(latest_by_vin.values(), key=lambda item: (item["licensePlate"], item["vin"]))
    dates = [row["createdAt"] for row in rows]
    grade_counts = Counter(row["gradeLabel"] or "Unspecified" for row in eligible)
    current_grade_counts = Counter(row["gradeLabel"] or "Unspecified" for row in latest)
    summary = {
        "rowsRead": len(raw_rows),
        "rowsParsed": len(rows),
        "rowsRejected": len(rejected),
        "completedRows": len(eligible),
        "incompleteRows": len(rows) - len(eligible),
        "uniqueVins": len(latest),
        "latestAssessments": len(latest),
        "currentFairOrBetter": sum(1 for row in latest if (row["grade"] or 0) >= 3),
        "currentPoor": sum(1 for row in latest if row["grade"] == 2),
        "currentGroundingRisk": sum(1 for row in latest if row["groundingRisk"]),
        "currentNewDamage": sum(1 for row in latest if row["hasNewDamage"]),
        "gradeCounts": dict(grade_counts),
        "currentGradeCounts": dict(current_grade_counts),
        "earliestAt": min(dates) if dates else None,
        "latestAt": max(dates) if dates else None,
    }
    period_key = (summary["latestAt"] or "")[:7] or None
    return {
        "ok": bool(rows), "provider": "pave", "providerLabel": "PAVE Fleet Dashboard",
        "periodKey": period_key, "detectedHeaders": list(reader.fieldnames or []),
        "summary": summary, "rows": rows, "latestByVin": latest, "rejectedRows": rejected,
    }
