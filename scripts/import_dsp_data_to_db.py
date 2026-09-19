#!/usr/bin/env python3
"""Import DSP data from files into SQLite database."""

import csv
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"


def parse_iso_duration(duration: str) -> float:
    """Parse ISO 8601 duration (e.g., PT10H30M) to total hours."""
    if not duration or duration == "PT0H":
        return 0.0
    hours = 0.0
    minutes = 0.0
    if "H" in duration:
        hours = float(duration.split("H")[0].replace("PT", ""))
    if "M" in duration:
        minutes_part = duration.split("H")[1].split("M")[0] if "H" in duration else duration.split("M")[0].replace("PT", "")
        minutes = float(minutes_part)
    return hours + (minutes / 60)


def import_adp_timecards(conn: sqlite3.Connection, adp_path: Path):
    """Import ADP timecard data into the database."""
    if not adp_path.exists():
        return
    
    with open(adp_path, encoding="utf-8") as f:
        timecards_data = json.load(f)
    
    cursor = conn.cursor()
    
    for associate in timecards_data:
        person = associate.get("personLegalName", {})
        name = person.get("formattedName", "Unknown")
        adp_oid = associate.get("personId", "")
        
        # Use ADP OID as driver_id
        driver_id = adp_oid
        
        # Insert or update driver
        cursor.execute("""
            INSERT OR REPLACE INTO drivers (id, name, status, source, adp_oid)
            VALUES (?, ?, ?, ?, ?)
        """, (driver_id, name, "Active", "ADP", adp_oid))
        
        for timecard in associate.get("timeCards", []):
            for day in timecard.get("dayEntries", []):
                date_str = day.get("entryDate", "")
                duration = day.get("totalPeriodTimeDuration", "PT0H")
                total_hours = parse_iso_duration(duration)
                timecard_id = timecard.get("timeCardId", "")
                pay_code = day.get("payCode", "")
                
                if date_str and total_hours is not None:
                    cursor.execute("""
                        INSERT OR REPLACE INTO adp_timecards (
                            driver_id, date, duration_hours, total_period_time, timecard_id, pay_code
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    """, (driver_id, date_str, total_hours, duration, timecard_id, pay_code))
    
    conn.commit()
    print(f"Imported ADP timecards from {adp_path.name}")


def import_amazon_routes(conn: sqlite3.Connection, week_folder: Path):
    """Import Amazon route data from DSP Overview Dashboard CSV."""
    overview_paths = list(week_folder.glob("DSP_Overview_Dashboard_*_*.csv"))
    if not overview_paths:
        return
    
    cursor = conn.cursor()
    
    with overview_paths[0].open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            name = row.get("Delivery Associate ", "").strip()
            if not name:
                continue
            
            # Use name as a lookup key (we'll match with ADP later)
            driver_id = name
            score = row.get("Overall Score", "").strip()
            packages = row.get("Packages Delivered", "0").strip()
            pod = row.get("POD", "").strip()
            cdf = row.get("CDF DPMO", "").strip()
            dsb = row.get("DSB", "").strip()
            standing = row.get("Overall Standing", "").strip()
            
            # Insert or update driver (Amazon source)
            cursor.execute("""
                INSERT OR IGNORE INTO drivers (id, name, status, source)
                VALUES (?, ?, ?, ?)
            """, (driver_id, name, standing or "Active", "Amazon"))
            
            # Store as a weekly route summary (is_weekly_aggregate=True)
            week = week_folder.name.replace("2026-wk", "2026-W")
            
            cursor.execute("""
                INSERT OR REPLACE INTO amazon_routes (
                    driver_id, route_code, date, stops, packages, status, 
                    overall_score, pod, cdf, dsb, is_weekly_aggregate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                driver_id,
                f"{week}-WEEKLY",
                week,
                None,
                int(packages) if packages else 0,
                "Completed",
                float(score) if score else None,
                float(pod.rstrip("%")) if pod else None,
                int(cdf) if cdf else None,
                int(dsb) if dsb else None,
                True  # Mark as weekly aggregate
            ))
    
    # Import per-day route assignments from DA Daily Reports (if available)
    import_driver_route_assignments(conn, week_folder)
    
    conn.commit()
    print(f"Imported Amazon routes from {week_folder.name}")


def import_driver_route_assignments(conn: sqlite3.Connection, week_folder: Path):
    """Import per-day route assignments from DA Daily Report PDFs (if available).
    
    This is a placeholder for when PDF parsing is available.
    For now, it checks for CSV files with route assignments.
    """
    cursor = conn.cursor()
    
    # Look for CSV files with route assignments (future-proofing)
    route_csvs = list(week_folder.glob("*route*.csv")) + list(week_folder.glob("*assignment*.csv"))
    for csv_file in route_csvs:
        try:
            with csv_file.open(newline="", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    driver_name = row.get("Driver", "").strip() or row.get("Delivery Associate", "").strip()
                    if not driver_name:
                        continue
                    
                    route_code = row.get("Route Code", "").strip() or row.get("Route", "").strip()
                    date_str = row.get("Date", "").strip()
                    stops = row.get("Stops", "0").strip()
                    packages = row.get("Packages", "0").strip()
                    status = row.get("Status", "Completed").strip()
                    
                    if not route_code or not date_str:
                        continue
                    
                    # Use driver name as ID (will match with drivers table)
                    driver_id = driver_name
                    
                    cursor.execute("""
                        INSERT OR IGNORE INTO driver_route_assignments (
                            driver_id, route_code, date, stops, packages, status
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        driver_id,
                        route_code,
                        date_str,
                        int(stops) if stops else None,
                        int(packages) if packages else None,
                        status
                    ))
        except Exception as e:
            print(f"Warning: Could not import {csv_file.name}: {e}")
            continue


def import_weekly_scorecard(conn: sqlite3.Connection, week_folder: Path):
    """Import weekly scorecard metrics from summary.md."""
    week_num = week_folder.name.split("-")[-1].replace("wk", "")  # e.g., "37" from "2026-wk37"
    summary_path = week_folder / f"week{week_num}-summary.md"
    if not summary_path.exists():
        return
    
    cursor = conn.cursor()
    
    with open(summary_path, encoding="utf-8") as f:
        summary_text = f.read()
    
    week = week_folder.name.replace("2026-wk", "2026-W")
    
    # Extract metrics from summary
    dcr_match = re.search(r"DCR landed at \*\*([\d.]+)%\*\*", summary_text)
    pod_match = re.search(r"POD at \*\*([\d.]+)%\*\*", summary_text)
    packages_match = re.search(r"handled \*\*([\d,]+)\*\* delivered packages", summary_text)
    das_match = re.search(r"\| Active DAs \| ([^|]+)", summary_text)
    safety_match = re.search(r"(\d+) negative feedback items[^,]*?(\d+) safety events", summary_text)
    cdf_match = re.search(r"\| CDF negatives \| ([^|]+)", summary_text)
    dsb_match = re.search(r"\| DSB defects \| ([^|]+)", summary_text)
    rating_match = re.search(r"Paid (\w+(?: \w+)?) incentive rating", summary_text)
    
    dcr = float(dcr_match.group(1)) if dcr_match else None
    pod = float(pod_match.group(1)) if pod_match else None
    packages = int(packages_match.group(1).replace(",", "")) if packages_match else None
    active_das = int(das_match.group(1).strip()) if das_match else None
    safety_events = int(safety_match.group(2)) if safety_match else None
    cdf = int(cdf_match.group(1).strip()) if cdf_match else None
    dsb = int(dsb_match.group(1).strip()) if dsb_match else None
    rating = rating_match.group(1) if rating_match else None
    
    cursor.execute("""
        INSERT OR REPLACE INTO weekly_scorecards (
            week, dcr, pod, cdf, dsb, safety_events, packages_delivered, active_das, incentive_rating
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (week, dcr, pod, cdf, dsb, safety_events, packages, active_das, rating))
    
    conn.commit()
    print(f"Imported weekly scorecard for {week}")


def import_disputes(conn: sqlite3.Connection, week_folder: Path):
    """Import dispute data from weekXX-amazon-submission-review.json."""
    dispute_folder = week_folder / "dispute"
    if not dispute_folder.exists():
        return
    
    cursor = conn.cursor()
    
    for review_file in dispute_folder.glob("week*-amazon-submission-review.json"):
        try:
            with open(review_file, encoding="utf-8") as f:
                review = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            continue
        
        # Handle both list and dict structures
        candidates = review if isinstance(review, list) else review.get("candidates", [])
        
        week = week_folder.name.replace("2026-wk", "2026-W")
        
        for candidate in candidates:
            driver_name = candidate.get("driverName", "Unknown")
            metric = candidate.get("metric", "Unknown")
            reason = candidate.get("reason", "")
            priority = candidate.get("priority", 0)
            appeal_details = candidate.get("appealDetails", "")
            tba_ids = json.dumps(candidate.get("tba_ids", []))
            evidence_sources = json.dumps(candidate.get("evidenceSources", []))
            
            # Use driver name as ID (will match with drivers table later)
            driver_id = driver_name
            
            # Insert dispute
            cursor.execute("""
                INSERT OR REPLACE INTO disputes (
                    id, week, driver_id, metric, reason, status, priority,
                    appeal_details, tba_ids, evidence_sources
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                candidate.get("submissionKey", f"{week}-{driver_name}"),
                week,
                driver_id,
                metric,
                reason,
                candidate.get("status", "Pending"),
                priority,
                appeal_details,
                tba_ids,
                evidence_sources
            ))
            
            # Update driver if not exists
            cursor.execute("""
                INSERT OR IGNORE INTO drivers (id, name, source)
                VALUES (?, ?, ?)
            """, (driver_id, driver_name, "Dispute"))
    
    conn.commit()
    print(f"Imported disputes from {week_folder.name}")


def main():
    """Import all DSP data into the database."""
    conn = sqlite3.connect(DB_PATH)
    # Disable foreign key checks during import for performance
    conn.execute("PRAGMA foreign_keys = OFF")
    
    # Import ADP timecards (latest snapshot)
    adp_timecard_path = max(
        ROOT.glob("data/adp/*/time-cards.json"),
        key=lambda p: p.stat().st_mtime,
        default=None
    )
    if adp_timecard_path:
        import_adp_timecards(conn, adp_timecard_path)
    
    # Import weekly data (all available weeks)
    scorecard_root = ROOT / "data/scorecard_data"
    for week_folder in sorted(scorecard_root.iterdir()):
        if week_folder.is_dir() and week_folder.name.startswith("2026-wk"):
            import_amazon_routes(conn, week_folder)
            import_weekly_scorecard(conn, week_folder)
            import_disputes(conn, week_folder)
    
    conn.close()
    print(f"Data import complete. Database at {DB_PATH}")


if __name__ == "__main__":
    main()
