#!/usr/bin/env python3
"""
Refresh DSP operations database with latest data.

Usage:
    python3 scripts/refresh_dsp_database.py          # Full refresh (rebuilds database)
    python3 scripts/refresh_dsp_database.py --incremental  # Only import new data
    python3 scripts/refresh_dsp_database.py --week 2026-wk37  # Refresh specific week
"""

import argparse
import csv
import json
import re
import sqlite3
import sys
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


def get_connection():
    """Get a database connection with foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_database(conn: sqlite3.Connection):
    """Initialize database tables (called only on full refresh)."""
    cursor = conn.cursor()
    
    cursor.execute("DROP TABLE IF EXISTS disputes")
    cursor.execute("DROP TABLE IF EXISTS weekly_scorecards")
    cursor.execute("DROP TABLE IF EXISTS driver_route_assignments")
    cursor.execute("DROP TABLE IF EXISTS amazon_routes")
    cursor.execute("DROP TABLE IF EXISTS adp_timecards")
    cursor.execute("DROP TABLE IF EXISTS drivers")
    cursor.execute("DROP VIEW IF EXISTS filed_disputes")
    cursor.execute("DROP VIEW IF EXISTS time_attendance_issues")
    
    # Drivers table
    cursor.execute("""
        CREATE TABLE drivers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT,
            source TEXT,
            adp_oid TEXT,
            amazon_transporter_id TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # ADP Timecards table
    cursor.execute("""
        CREATE TABLE adp_timecards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            date TEXT NOT NULL,
            duration_hours REAL,
            total_period_time TEXT,
            timecard_id TEXT,
            pay_code TEXT,
            entry_date TEXT,
            UNIQUE(driver_id, date, timecard_id)
        )
    """)
    
    # Amazon Routes table (weekly aggregates)
    cursor.execute("""
        CREATE TABLE amazon_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            route_code TEXT NOT NULL,
            date TEXT NOT NULL,
            stops INTEGER,
            packages INTEGER,
            status TEXT,
            overall_score REAL,
            pod REAL,
            cdf INTEGER,
            dsb INTEGER,
            is_weekly_aggregate BOOLEAN DEFAULT FALSE,
            UNIQUE(driver_id, route_code, date)
        )
    """)
    
    # Per-day route assignments table
    cursor.execute("""
        CREATE TABLE driver_route_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            route_code TEXT NOT NULL,
            date TEXT NOT NULL,
            stops INTEGER,
            packages INTEGER,
            status TEXT,
            start_time TEXT,
            end_time TEXT,
            vehicle_id TEXT,
            UNIQUE(driver_id, route_code, date)
        )
    """)
    
    # Weekly Scorecards table
    cursor.execute("""
        CREATE TABLE weekly_scorecards (
            week TEXT PRIMARY KEY,
            dcr REAL,
            pod REAL,
            cdf INTEGER,
            dsb INTEGER,
            safety_events INTEGER,
            packages_delivered INTEGER,
            active_das INTEGER,
            incentive_rating TEXT,
            sentiment_favorable REAL,
            sentiment_response REAL,
            dvic_count INTEGER,
            dvic_avg_seconds REAL,
            snapshot_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Disputes table
    cursor.execute("""
        CREATE TABLE disputes (
            id TEXT PRIMARY KEY,
            week TEXT REFERENCES weekly_scorecards(week),
            driver_id TEXT REFERENCES drivers(id),
            metric TEXT,
            reason TEXT,
            status TEXT,
            submitted_at TEXT,
            confirmation_number TEXT,
            outcome TEXT,
            tba_ids TEXT,
            evidence_sources TEXT,
            priority INTEGER,
            appeal_details TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Views
    cursor.execute("""
        CREATE VIEW time_attendance_issues AS
        SELECT
            a.driver_id,
            d.name AS employee,
            a.date,
            a.duration_hours,
            CASE
                WHEN a.duration_hours = 0 THEN 'Missed punch'
                WHEN a.duration_hours > 10 THEN 'Long shift'
                WHEN ra.route_code IS NULL AND a.duration_hours > 0 THEN 'Unassigned shift'
                ELSE NULL
            END AS issue_type,
            CASE
                WHEN a.duration_hours = 0 THEN 'No time recorded for ' || a.date
                WHEN a.duration_hours > 10 THEN printf('%.2f hours', a.duration_hours)
                WHEN ra.route_code IS NULL THEN 'ADP time but no Amazon route assignment'
                ELSE NULL
            END AS details
        FROM adp_timecards a
        JOIN drivers d ON a.driver_id = d.id
        LEFT JOIN driver_route_assignments ra ON a.driver_id = ra.driver_id AND a.date = ra.date
        WHERE a.duration_hours IS NOT NULL
          AND (
            a.duration_hours = 0
            OR a.duration_hours > 10
            OR (ra.route_code IS NULL AND a.duration_hours > 0)
          )
        ORDER BY d.name, a.date
    """)
    
    cursor.execute("""
        CREATE VIEW filed_disputes AS
        SELECT
            disputes.week,
            d.name AS driver,
            disputes.metric,
            disputes.reason,
            disputes.status,
            disputes.submitted_at,
            disputes.confirmation_number,
            disputes.outcome,
            disputes.tba_ids,
            disputes.priority
        FROM disputes
        JOIN drivers d ON disputes.driver_id = d.id
        ORDER BY disputes.week DESC, d.name
    """)
    
    # Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_adp_timecards_driver_date ON adp_timecards(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_amazon_routes_driver_date ON amazon_routes(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_driver_route_assignments_driver_date ON driver_route_assignments(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_week ON disputes(week)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)")
    
    conn.commit()


def import_adp_timecards(conn: sqlite3.Connection, adp_path: Path):
    """Import ADP timecard data."""
    if not adp_path.exists():
        return 0
    
    with open(adp_path, encoding="utf-8") as f:
        timecards_data = json.load(f)
    
    cursor = conn.cursor()
    imported = 0
    
    for associate in timecards_data:
        person = associate.get("personLegalName", {})
        name = person.get("formattedName", "Unknown")
        adp_oid = associate.get("personId", "")
        driver_id = adp_oid
        
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
                    imported += 1
    
    conn.commit()
    return imported


def import_amazon_routes(conn: sqlite3.Connection, week_folder: Path):
    """Import Amazon route data from DSP Overview Dashboard CSV."""
    overview_paths = list(week_folder.glob("DSP_Overview_Dashboard_*_*.csv"))
    if not overview_paths:
        return 0
    
    cursor = conn.cursor()
    imported = 0
    
    with overview_paths[0].open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            name = row.get("Delivery Associate ", "").strip()
            if not name:
                continue
            
            driver_id = name
            score = row.get("Overall Score", "").strip()
            packages = row.get("Packages Delivered", "0").strip()
            pod = row.get("POD", "").strip()
            cdf = row.get("CDF DPMO", "").strip()
            dsb = row.get("DSB", "").strip()
            standing = row.get("Overall Standing", "").strip()
            
            cursor.execute("""
                INSERT OR IGNORE INTO drivers (id, name, status, source)
                VALUES (?, ?, ?, ?)
            """, (driver_id, name, standing or "Active", "Amazon"))
            
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
                True
            ))
            imported += 1
    
    conn.commit()
    return imported


def import_driver_route_assignments(conn: sqlite3.Connection, week_folder: Path):
    """Import per-day route assignments from CSV files (if available)."""
    cursor = conn.cursor()
    imported = 0
    
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
                    imported += 1
        except Exception as e:
            print(f"Warning: Could not import {csv_file.name}: {e}")
            continue
    
    conn.commit()
    return imported


def import_weekly_scorecard(conn: sqlite3.Connection, week_folder: Path):
    """Import weekly scorecard metrics from summary.md."""
    week_num = week_folder.name.split("-")[-1].replace("wk", "")
    summary_path = week_folder / f"week{week_num}-summary.md"
    if not summary_path.exists():
        return 0
    
    cursor = conn.cursor()
    
    with open(summary_path, encoding="utf-8") as f:
        summary_text = f.read()
    
    week = week_folder.name.replace("2026-wk", "2026-W")
    
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
    return 1


def import_disputes(conn: sqlite3.Connection, week_folder: Path):
    """Import dispute data from weekXX-amazon-submission-review.json."""
    dispute_folder = week_folder / "dispute"
    if not dispute_folder.exists():
        return 0
    
    cursor = conn.cursor()
    imported = 0
    
    for review_file in dispute_folder.glob("week*-amazon-submission-review.json"):
        try:
            with open(review_file, encoding="utf-8") as f:
                review = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            continue
        
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
            
            driver_id = driver_name
            
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
            
            cursor.execute("""
                INSERT OR IGNORE INTO drivers (id, name, source)
                VALUES (?, ?, ?)
            """, (driver_id, driver_name, "Dispute"))
            imported += 1
    
    conn.commit()
    return imported


def import_week(conn: sqlite3.Connection, week_folder: Path):
    """Import all data for a single week."""
    total = 0
    total += import_amazon_routes(conn, week_folder)
    total += import_weekly_scorecard(conn, week_folder)
    total += import_disputes(conn, week_folder)
    total += import_driver_route_assignments(conn, week_folder)
    return total


def full_refresh():
    """Full database refresh: rebuild everything from scratch."""
    print("Starting full database refresh...")
    
    # Reinitialize database
    conn = get_connection()
    init_database(conn)
    conn.close()
    
    # Reimport all data
    conn = get_connection()
    
    # Import ADP timecards (latest snapshot)
    adp_timecard_path = max(
        ROOT.glob("data/adp/*/time-cards.json"),
        key=lambda p: p.stat().st_mtime,
        default=None
    )
    if adp_timecard_path:
        count = import_adp_timecards(conn, adp_timecard_path)
        print(f"Imported {count} ADP timecards from {adp_timecard_path.name}")
    
    # Import all weeks
    scorecard_root = ROOT / "data/scorecard_data"
    for week_folder in sorted(scorecard_root.iterdir()):
        if week_folder.is_dir() and week_folder.name.startswith("2026-wk"):
            count = import_week(conn, week_folder)
            print(f"Imported {count} records from {week_folder.name}")
    
    conn.close()
    print(f"Full refresh complete. Database at {DB_PATH}")


def incremental_refresh():
    """Incremental refresh: only import new/updated data."""
    print("Starting incremental database refresh...")
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Import latest ADP timecards (only if newer than what's in the database)
    adp_timecard_path = max(
        ROOT.glob("data/adp/*/time-cards.json"),
        key=lambda p: p.stat().st_mtime,
        default=None
    )
    if adp_timecard_path:
        # Check if we already have this snapshot
        cursor.execute("SELECT MAX(entry_date) FROM adp_timecards")
        latest_db_date = cursor.fetchone()[0]
        
        # Get the latest date from the file
        with open(adp_timecard_path, encoding="utf-8") as f:
            timecards_data = json.load(f)
        latest_file_date = None
        for associate in timecards_data:
            for timecard in associate.get("timeCards", []):
                for day in timecard.get("dayEntries", []):
                    date_str = day.get("entryDate", "")
                    if date_str and (latest_file_date is None or date_str > latest_file_date):
                        latest_file_date = date_str
        
        if latest_file_date and latest_db_date and latest_file_date <= latest_db_date:
            print(f"ADP timecards already up to date (latest: {latest_file_date})")
        else:
            count = import_adp_timecards(conn, adp_timecard_path)
            print(f"Imported {count} ADP timecards from {adp_timecard_path.name}")
    
    # Import all weeks (skip if weekly scorecard already exists)
    scorecard_root = ROOT / "data/scorecard_data"
    for week_folder in sorted(scorecard_root.iterdir()):
        if week_folder.is_dir() and week_folder.name.startswith("2026-wk"):
            week = week_folder.name.replace("2026-wk", "2026-W")
            cursor.execute("SELECT 1 FROM weekly_scorecards WHERE week = ?", (week,))
            if cursor.fetchone():
                print(f"Week {week} already in database, skipping")
                continue
            count = import_week(conn, week_folder)
            if count > 0:
                print(f"Imported {count} new records from {week_folder.name}")
    
    conn.close()
    print(f"Incremental refresh complete. Database at {DB_PATH}")


def refresh_week(week_name: str):
    """Refresh a specific week."""
    week_folder = ROOT / "data/scorecard_data" / week_name
    if not week_folder.exists():
        print(f"Error: Week folder {week_name} not found")
        return
    
    print(f"Refreshing week {week_name}...")
    conn = get_connection()
    count = import_week(conn, week_folder)
    conn.close()
    print(f"Imported {count} records from {week_name}")


def main():
    parser = argparse.ArgumentParser(description="Refresh DSP operations database")
    parser.add_argument("--incremental", action="store_true", help="Only import new/updated data")
    parser.add_argument("--week", type=str, help="Refresh a specific week (e.g., 2026-wk37)")
    args = parser.parse_args()
    
    if args.week:
        refresh_week(args.week)
    elif args.incremental:
        incremental_refresh()
    else:
        full_refresh()


if __name__ == "__main__":
    main()
