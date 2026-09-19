#!/usr/bin/env python3
"""Initialize SQLite database for DSP operations data."""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"


def init_database():
    """Create database tables for DSP operations."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Enable foreign key support
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Drivers table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS drivers (
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
        CREATE TABLE IF NOT EXISTS adp_timecards (
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
    
    # Amazon Routes table (weekly aggregates from DSP Overview)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS amazon_routes (
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
    
    # Per-day route assignments table (for DA Daily Reports)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS driver_route_assignments (
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
    
    # Vans table (fleet vehicles)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS vans (
            id TEXT PRIMARY KEY,
            van_number TEXT NOT NULL,
            vin TEXT,
            make TEXT,
            model TEXT,
            year INTEGER,
            status TEXT,
            ownership TEXT,
            notes TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Daily data entry form (editable by team)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_route_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            van_id TEXT REFERENCES vans(id),
            route_code TEXT,
            date TEXT NOT NULL,
            stops INTEGER,
            packages INTEGER,
            status TEXT,
            start_time TEXT,
            end_time TEXT,
            notes TEXT,
            entered_by TEXT DEFAULT 'system',
            entered_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(driver_id, route_code, date)
        )
    """)
    
    # History for revert capability
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_entries_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER REFERENCES daily_route_entries(id),
            driver_id TEXT,
            driver_name TEXT,
            van_id TEXT,
            van_number TEXT,
            route_code TEXT,
            date TEXT,
            stops INTEGER,
            packages INTEGER,
            status TEXT,
            start_time TEXT,
            end_time TEXT,
            notes TEXT,
            changed_by TEXT,
            changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            change_type TEXT
        )
    """)
    
    # Weekly Scorecards table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS weekly_scorecards (
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
        CREATE TABLE IF NOT EXISTS disputes (
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
    
    # Driver Performance Tracking table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS driver_performance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            week TEXT,
            dcr REAL,
            pod REAL,
            cdf_negatives INTEGER,
            dsb_defects INTEGER,
            safety_events INTEGER,
            packages_delivered INTEGER,
            overall_score REAL,
            ranking INTEGER,
            tier TEXT,
            trend_6week REAL,
            retention_risk TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(driver_id, week)
        )
    """)
    
    # Fleet Costs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fleet_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            van_id TEXT REFERENCES vans(id),
            week TEXT,
            ownership TEXT,
            monthly_cost REAL,
            daily_cost REAL,
            vehicle_days INTEGER,
            operational_status TEXT,
            maintenance_cost REAL,
            fuel_cost REAL,
            total_cost REAL,
            cost_per_package REAL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(van_id, week)
        )
    """)
    
    # Route Monitoring table (live route data)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS route_monitoring (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_code TEXT NOT NULL,
            driver_id TEXT REFERENCES drivers(id),
            date TEXT NOT NULL,
            planned_stops INTEGER,
            completed_stops INTEGER,
            planned_packages INTEGER,
            delivered_packages INTEGER,
            status TEXT,
            start_time TEXT,
            end_time TEXT,
            current_location TEXT,
            eta TEXT,
            delay_minutes INTEGER,
            completion_percentage REAL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(route_code, date)
        )
    """)
    
    # Payroll Reconciliation table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS payroll_reconciliation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id TEXT REFERENCES drivers(id),
            date TEXT NOT NULL,
            adp_hours REAL,
            route_hours REAL,
            adp_regular REAL,
            adp_overtime REAL,
            route_packages INTEGER,
            discrepancy_type TEXT,
            discrepancy_amount REAL,
            severity TEXT,
            resolution_status TEXT,
            resolved_at TEXT,
            notes TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(driver_id, date)
        )
    """)
    
    # Dispute Candidates table (auto-detected)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dispute_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week TEXT,
            driver_id TEXT REFERENCES drivers(id),
            metric TEXT,
            reason TEXT,
            confidence TEXT,
            evidence TEXT,
            priority INTEGER,
            status TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(week, driver_id, metric)
        )
    """)
    
    # Time & Attendance issues view
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS time_attendance_issues AS
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
    
    # Disputes view (filed disputes with status)
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS filed_disputes AS
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
    
    # Indexes for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_adp_timecards_driver_date ON adp_timecards(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_amazon_routes_driver_date ON amazon_routes(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_week ON disputes(week)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_entries_date ON daily_route_entries(date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_entries_driver_date ON daily_route_entries(driver_id, date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_entries_van ON daily_route_entries(van_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_history_entry ON daily_entries_history(entry_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_history_date ON daily_entries_history(date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vans_status ON vans(status)")
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")


if __name__ == "__main__":
    init_database()
