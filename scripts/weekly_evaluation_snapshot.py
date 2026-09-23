#!/usr/bin/env python3
"""Build the weekly-evaluation API payload independently of the legacy dashboard."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCORECARD_ROOT = ROOT / "data" / "scorecard_data"


def _numeric(value: str | None) -> float | None:
    if not value or value.lower() in {"n/a", "unavailable"}:
        return None
    match = re.search(r"-?[\d,]+(?:\.\d+)?", value)
    return float(match.group().replace(",", "")) if match else None


def _section(text: str, heading: str) -> str:
    match = re.search(
        rf"^## {re.escape(heading)}\s*\n(.*?)(?=^## |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        return "Unavailable"
    value = re.sub(r"^###\s+", "• ", match.group(1), flags=re.MULTILINE)
    value = value.replace("**", "").replace("`", "")
    value = re.sub(r"^\s*-\s+", "", value, flags=re.MULTILINE).strip()
    return re.sub(r"\s+", " ", value)


def _metric(summary: str, label: str) -> str | None:
    match = re.search(
        rf"^\| {re.escape(label)} \| ([^|]+)", summary, re.MULTILINE
    )
    return match.group(1).strip() if match else None


def _drivers(folder: Path) -> list[dict[str, str]]:
    paths = sorted(folder.glob("DSP_Overview_Dashboard_*_*.csv"))
    if not paths:
        return []
    with paths[0].open(newline="", encoding="utf-8-sig") as handle:
        rows = []
        for row in csv.DictReader(handle):
            name = row.get("Delivery Associate ", "").strip()
            score = row.get("Overall Score", "").strip()
            if not name or _numeric(score) is None:
                continue
            rows.append({
                "name": name,
                "standing": row.get("Overall Standing", "").strip() or "Unrated",
                "score": score,
                "packages": row.get("Packages Delivered", "0").strip() or "0",
                "pod": row.get("POD", "").strip(),
                "cdf": row.get("CDF DPMO", "").strip(),
                "dsb": row.get("DSB", "").strip(),
            })
        return rows


def build_weekly_evaluations_payload() -> dict[str, object]:
    evaluations: dict[str, dict[str, object]] = {}
    folders = sorted(SCORECARD_ROOT.glob("????-wk??"), reverse=True)
    for folder in folders:
        match = re.fullmatch(r"(\d{4})-wk(\d{2})", folder.name)
        if not match:
            continue
        year, week_text = match.groups()
        week_number = int(week_text)
        summary_path = folder / f"week{week_number}-summary.md"
        if not summary_path.exists():
            continue
        summary = summary_path.read_text(encoding="utf-8")
        disputes_path = folder / f"week{week_number}-disputes.md"
        disputes = disputes_path.read_text(encoding="utf-8") if disputes_path.exists() else ""
        candidate_path = folder / "dispute" / f"week{week_number}-amazon-submission-review.json"
        raw_candidates = json.loads(candidate_path.read_text(encoding="utf-8")) if candidate_path.exists() else []
        candidates = [
            item for item in raw_candidates
            if item.get("status") == "ready_for_review" and not item.get("blockingIssue")
        ]
        drivers = _drivers(folder)
        top = sorted(drivers, key=lambda row: (-float(row["score"]), row["name"]))[:10]
        bottom = sorted(drivers, key=lambda row: (float(row["score"]), row["name"]))[:10]
        dvic = re.search(r"Average DVIC duration was \*\*([\d.]+) seconds\*\*", summary)
        sentiment = re.search(r"Driver sentiment .*? favorable response rate was \*\*([\d.]+)%\*\*", summary)
        key = f"{year}-W{week_number:02d}"
        evaluations[key] = {
            "week": key,
            "summary": _section(summary, "Executive Summary"),
            "disputeRead": _section(disputes, "Executive Dispute Read") if disputes else "Dispute report unavailable.",
            "coachingLanes": _section(disputes, "Do Not File / Coaching-First Lanes") if disputes else "Unavailable",
            "metrics": {
                "rating": "See weekly scorecard",
                "averageScore": _numeric(_metric(summary, "Avg overall score")),
                "activeDAs": _numeric(_metric(summary, "Active DAs")),
                "packages": _numeric(_metric(summary, "Packages delivered")),
                "dcr": _numeric(_metric(summary, "DCR")),
                "pod": _numeric(_metric(summary, "POD")),
                "cdf": _numeric(_metric(summary, "CDF negative feedback")),
                "dsb": _numeric(_metric(summary, "DSB defects")),
                "failedPickups": _numeric(_metric(summary, "Failed pickup stops")),
                "safety": _numeric(_metric(summary, "Safety events")),
                "dvicAverage": float(dvic.group(1)) if dvic else None,
                "sentiment": float(sentiment.group(1)) if sentiment else None,
                "capacityReliability": _metric(summary, "Capacity reliability") or "Unavailable",
                "casCompliance": _metric(summary, "CAS compliance") or "Unavailable",
                "tenuredWorkforce": _metric(summary, "Tenured workforce") or "Unavailable",
            },
            "topDrivers": top,
            "bottomDrivers": bottom,
            "candidates": candidates,
        }
    return {"weeks": list(evaluations), "evaluations": evaluations}


if __name__ == "__main__":
    print(json.dumps(build_weekly_evaluations_payload(), indent=2))
