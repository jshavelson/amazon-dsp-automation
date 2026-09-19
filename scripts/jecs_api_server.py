#!/usr/bin/env python3
"""
JECS Unified API Server for DSP Operations.

Provides endpoints for:
- Daily Entry Form (drivers, vans, entries)
- Driver Performance Dashboard
- Fleet Cost Optimization
- Dispute Detection
- Route Monitoring
- Payroll Reconciliation

Usage:
    python3 scripts/jecs_api_server.py
    
Then open: http://localhost:8000/amazon-dsp-kpi-dashboard.html
"""

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"
DASHBOARD_DIR = ROOT / "data/dashboards"
DASHBOARD_PATH = DASHBOARD_DIR / "amazon-dsp-kpi-dashboard.html"


def get_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


class JecsAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for JECS API."""
    
    def log_message(self, format, *args):
        """Suppress default logging."""
        pass
    
    def do_GET(self):
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        
        try:
            # Daily Entry Form endpoints
            if path == '/api/drivers':
                self.handle_get_drivers()
            elif path == '/api/vans':
                self.handle_get_vans()
            elif path == '/api/daily-entries':
                self.handle_get_daily_entries(query)
            elif path == '/api/daily-entries/history':
                self.handle_get_history(query)
            
            # Driver Performance endpoints
            elif path == '/api/driver-performance':
                self.handle_get_driver_performance(query)
            
            # Fleet Cost Optimization endpoints
            elif path == '/api/fleet-optimization':
                self.handle_get_fleet_optimization(query)
            elif path == '/api/fleet-costs':
                self.handle_get_fleet_costs(query)
            
            # Dispute Detection endpoints
            elif path == '/api/disputes':
                self.handle_get_disputes(query)
            elif path == '/api/disputes/candidates':
                self.handle_get_dispute_candidates(query)
            
            # PAVE endpoints
            elif path == '/api/pave/vehicles':
                self.handle_get_pave_vehicles(query)
            
            # Route Monitoring endpoints
            elif path == '/api/route-monitor':
                self.handle_get_route_monitor(query)
            
            # Payroll Reconciliation endpoints
            elif path == '/api/payroll':
                self.handle_get_payroll(query)
            elif path == '/api/payroll/discrepancies':
                self.handle_get_payroll_discrepancies(query)
            
            # Dashboard files
            elif path == '/amazon-dsp-kpi-dashboard.html':
                self.handle_dashboard_html()
            elif path == '/daily-entry-form.html':
                self.handle_form_html()
            elif path.startswith('/data/dashboards/'):
                self.handle_dashboard_file()
            elif path == '/' or path == '/daily-entry':
                self.handle_redirect_to_dashboard()
            else:
                self.send_error(404, f"Not found: {path}")
        except Exception as e:
            self.send_error(500, f"Error: {str(e)}")
    
    def do_POST(self):
        """Handle POST requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        
        try:
            if path == '/api/daily-entries':
                self.handle_post_daily_entries()
            elif path == '/api/daily-entries/revert':
                self.handle_post_revert(query)
            else:
                self.send_error(404, f"Not found: {path}")
        except Exception as e:
            self.send_error(500, f"Error: {str(e)}")
    
    def do_OPTIONS(self):
        """Handle OPTIONS for CORS."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ========== Daily Entry Form Handlers ==========
    
    def handle_get_drivers(self):
        """Return list of all drivers."""
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, status FROM drivers ORDER BY name")
        drivers = [dict(row) for row in cursor.fetchall()]
        conn.close()
        self.send_json(drivers)
    
    def handle_get_vans(self):
        """Return list of all vans."""
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, van_number, vin, make, model, year, status, ownership FROM vans ORDER BY van_number")
        vans = [dict(row) for row in cursor.fetchall()]
        conn.close()
        self.send_json(vans)
    
    def handle_get_daily_entries(self, query):
        """Return daily entries for a specific date."""
        date = query.get('date', [None])[0]
        if not date:
            self.send_error(400, "Missing date parameter")
            return
        
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                de.id, de.driver_id, d.name as driver_name,
                de.van_id, v.van_number,
                de.route_code, de.date, de.stops, de.packages,
                de.status, de.start_time, de.end_time, de.notes
            FROM daily_route_entries de
            LEFT JOIN drivers d ON de.driver_id = d.id
            LEFT JOIN vans v ON de.van_id = v.id
            WHERE de.date = ?
            ORDER BY d.name, de.route_code
        """, (date,))
        entries = [dict(row) for row in cursor.fetchall()]
        conn.close()
        self.send_json(entries)
    
    def handle_get_history(self, query):
        """Return history for a specific date."""
        date = query.get('date', [None])[0]
        if not date:
            self.send_error(400, "Missing date parameter")
            return
        
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                h.id, h.entry_id, h.driver_id, h.driver_name,
                h.van_id, h.van_number,
                h.route_code, h.date, h.stops, h.packages,
                h.status, h.start_time, h.end_time, h.notes,
                h.changed_by, h.changed_at, h.change_type
            FROM daily_entries_history h
            WHERE h.date = ?
            ORDER BY h.changed_at DESC
        """, (date,))
        history = [dict(row) for row in cursor.fetchall()]
        conn.close()
        self.send_json(history)
    
    def handle_post_daily_entries(self):
        """Save daily entries (auto-save)."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body)
        
        entries = data.get('entries', [])
        date = data.get('date')
        
        if not date:
            self.send_error(400, "Missing date")
            return
        
        conn = get_connection()
        cursor = conn.cursor()
        
        history_entries = []
        
        for entry in entries:
            entry_id = entry.get('id')
            driver_id = entry.get('driver_id')
            van_id = entry.get('van_id')
            route_code = entry.get('route_code')
            stops = entry.get('stops')
            packages = entry.get('packages')
            status = entry.get('status')
            start_time = entry.get('start_time')
            end_time = entry.get('end_time')
            notes = entry.get('notes')
            deleted = entry.get('deleted', False)
            
            if deleted and entry_id and entry_id != 'new':
                cursor.execute("""
                    SELECT de.*, d.name as driver_name, v.van_number 
                    FROM daily_route_entries de
                    LEFT JOIN drivers d ON de.driver_id = d.id
                    LEFT JOIN vans v ON de.van_id = v.id
                    WHERE de.id = ?
                """, (entry_id,))
                old_entry = cursor.fetchone()
                if old_entry:
                    history_entries.append({
                        'entry_id': entry_id,
                        'driver_id': old_entry['driver_id'],
                        'driver_name': old_entry['driver_name'],
                        'van_id': old_entry['van_id'],
                        'van_number': old_entry['van_number'],
                        'route_code': old_entry['route_code'],
                        'date': old_entry['date'],
                        'stops': old_entry['stops'],
                        'packages': old_entry['packages'],
                        'status': old_entry['status'],
                        'start_time': old_entry['start_time'],
                        'end_time': old_entry['end_time'],
                        'notes': old_entry['notes'],
                        'changed_by': 'system',
                        'change_type': 'delete'
                    })
                cursor.execute("DELETE FROM daily_route_entries WHERE id = ?", (entry_id,))
            elif entry_id and entry_id != 'new':
                cursor.execute("""
                    SELECT de.*, d.name as driver_name, v.van_number 
                    FROM daily_route_entries de
                    LEFT JOIN drivers d ON de.driver_id = d.id
                    LEFT JOIN vans v ON de.van_id = v.id
                    WHERE de.id = ?
                """, (entry_id,))
                old_entry = cursor.fetchone()
                if old_entry:
                    history_entries.append({
                        'entry_id': entry_id,
                        'driver_id': old_entry['driver_id'],
                        'driver_name': old_entry['driver_name'],
                        'van_id': old_entry['van_id'],
                        'van_number': old_entry['van_number'],
                        'route_code': old_entry['route_code'],
                        'date': old_entry['date'],
                        'stops': old_entry['stops'],
                        'packages': old_entry['packages'],
                        'status': old_entry['status'],
                        'start_time': old_entry['start_time'],
                        'end_time': old_entry['end_time'],
                        'notes': old_entry['notes'],
                        'changed_by': 'system',
                        'change_type': 'update'
                    })
                cursor.execute("""
                    UPDATE daily_route_entries SET
                        driver_id = ?, van_id = ?, route_code = ?, stops = ?, packages = ?,
                        status = ?, start_time = ?, end_time = ?, notes = ?
                    WHERE id = ?
                """, (
                    driver_id, van_id, route_code, stops, packages,
                    status, start_time, end_time, notes, entry_id
                ))
            else:
                cursor.execute("""
                    INSERT INTO daily_route_entries (
                        driver_id, van_id, route_code, date, stops, packages,
                        status, start_time, end_time, notes, entered_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    driver_id, van_id, route_code, date, stops, packages,
                    status, start_time, end_time, notes, 'system'
                ))
                entry_id = cursor.lastrowid
                history_entries.append({
                    'entry_id': entry_id,
                    'driver_id': driver_id,
                    'driver_name': '',
                    'van_id': van_id,
                    'van_number': '',
                    'route_code': route_code,
                    'date': date,
                    'stops': stops,
                    'packages': packages,
                    'status': status,
                    'start_time': start_time,
                    'end_time': end_time,
                    'notes': notes,
                    'changed_by': 'system',
                    'change_type': 'create'
                })
        
        for history in history_entries:
            cursor.execute("""
                INSERT INTO daily_entries_history (
                    entry_id, driver_id, driver_name, van_id, van_number,
                    route_code, date, stops, packages, status, start_time, end_time,
                    notes, changed_by, change_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                history['entry_id'],
                history['driver_id'],
                history.get('driver_name', ''),
                history['van_id'],
                history.get('van_number', ''),
                history['route_code'],
                history['date'],
                history['stops'],
                history['packages'],
                history['status'],
                history['start_time'],
                history['end_time'],
                history['notes'],
                history['changed_by'],
                history['change_type']
            ))
        
        conn.commit()
        
        cursor.execute("""
            SELECT 
                de.id, de.driver_id, d.name as driver_name,
                de.van_id, v.van_number,
                de.route_code, de.date, de.stops, de.packages,
                de.status, de.start_time, de.end_time, de.notes
            FROM daily_route_entries de
            LEFT JOIN drivers d ON de.driver_id = d.id
            LEFT JOIN vans v ON de.van_id = v.id
            WHERE de.date = ?
            ORDER BY d.name, de.route_code
        """, (date,))
        updated_entries = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        self.send_json({'entries': updated_entries, 'saved': True})
    
    def handle_post_revert(self, query):
        """Revert to a specific history entry."""
        history_id = query.get('history_id', [None])[0]
        if not history_id:
            self.send_error(400, "Missing history_id parameter")
            return
        
        conn = get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM daily_entries_history WHERE id = ?", (history_id,))
        history = cursor.fetchone()
        if not history:
            self.send_error(404, "History entry not found")
            return
        
        if history['change_type'] == 'delete':
            cursor.execute("""
                INSERT INTO daily_route_entries (
                    id, driver_id, van_id, route_code, date, stops, packages,
                    status, start_time, end_time, notes, entered_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                history['entry_id'], history['driver_id'], history['van_id'],
                history['route_code'], history['date'], history['stops'], history['packages'],
                history['status'], history['start_time'], history['end_time'],
                history['notes'], 'reverted'
            ))
        else:
            cursor.execute("""
                UPDATE daily_route_entries SET
                    driver_id = ?, van_id = ?, route_code = ?, stops = ?, packages = ?,
                    status = ?, start_time = ?, end_time = ?, notes = ?
                WHERE id = ?
            """, (
                history['driver_id'], history['van_id'], history['route_code'],
                history['stops'], history['packages'], history['status'],
                history['start_time'], history['end_time'], history['notes'],
                history['entry_id']
            ))
        
        cursor.execute("""
            INSERT INTO daily_entries_history (
                entry_id, driver_id, driver_name, van_id, van_number,
                route_code, date, stops, packages, status, start_time, end_time,
                notes, changed_by, change_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            history['entry_id'], history['driver_id'], history.get('driver_name', ''),
            history['van_id'], history.get('van_number', ''), history['route_code'],
            history['date'], history['stops'], history['packages'], history['status'],
            history['start_time'], history['end_time'], history['notes'],
            'system', 'revert'
        ))
        
        conn.commit()
        conn.close()
        
        self.send_json({'reverted': True})

    # ========== Driver Performance Handlers ==========
    
    def handle_get_driver_performance(self, query):
        """Return driver performance summary."""
        week = query.get('week', ['2026-wk37'])[0]
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get driver performance from amazon_routes (weekly aggregates)
        cursor.execute("""
            SELECT 
                ar.driver_id,
                d.name as driver_name,
                ar.overall_score,
                ar.pod,
                ar.cdf,
                ar.dsb,
                ar.packages,
                ar.stops,
                ar.date
            FROM amazon_routes ar
            JOIN drivers d ON ar.driver_id = d.id
            WHERE ar.is_weekly_aggregate = 1
            ORDER BY ar.overall_score DESC NULLS LAST
            LIMIT 50
        """)
        routes = cursor.fetchall()
        
        # Build performance summary
        performance = []
        for route in routes:
            performance.append({
                'driver_id': route['driver_id'],
                'driver_name': route['driver_name'],
                'dcr': route['overall_score'] or 0,
                'pod': route['pod'] or 0,
                'cdf_negatives': route['cdf'] or 0,
                'dsb_defects': route['dsb'] or 0,
                'safety_events': 0,  # Will populate from safety table if available
                'packages_delivered': route['packages'] or 0,
                'score': route['overall_score'] or 0
            })
        
        # Sort by score (descending)
        performance.sort(key=lambda x: x['score'], reverse=True)
        
        conn.close()
        self.send_json(performance)
    
    def _calculate_driver_score(self, scorecard):
        """Calculate a composite score for a driver."""
        dcr = scorecard['dcr'] or 0
        pod = scorecard['pod'] or 0
        cdf = scorecard['cdf_negatives'] or 0
        dsb = scorecard['dsb_defects'] or 0
        safety = scorecard['safety_events'] or 0
        
        # Weighted score (DCR and POD are most important)
        score = (dcr * 0.4) + (pod * 0.4) - (cdf * 50) - (dsb * 100) - (safety * 200)
        return round(score, 2)

    # ========== Fleet Cost Optimization Handlers ==========
    
    def handle_get_fleet_optimization(self, query):
        """Return fleet cost optimization analysis."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get fleet data
        cursor.execute("SELECT id, van_number, vin, make, model, year, status, ownership, notes, updated_at FROM vans")
        vans = [dict(row) for row in cursor.fetchall()]
        
        # Get ownership breakdown
        ownership = {'AMAZON_OWNED': 0, 'AMAZON_RENTAL': 0, 'RENTAL': 0, 'LEASE': 0}
        for van in vans:
            ownership[van['ownership']] = ownership.get(van['ownership'], 0) + 1
        
        # Get operational status
        operational = sum(1 for v in vans if v['status'] == 'OPERATIONAL')
        grounded = len(vans) - operational
        
        result = {
            'total_vans': len(vans),
            'operational': operational,
            'grounded': grounded,
            'ownership': ownership,
            'vans': vans
        }
        
        conn.close()
        self.send_json(result)

    def handle_get_fleet_costs(self, query):
        """Return fleet cost data with rental vs Amazon reimbursement breakdown."""
        # Fleet cost data from reconciliation
        # This data comes from: data/fleet_reviews/2026-09-07/three-month-reconciliation/JEC-June-August-Rental-Reconciliation.xlsx
        # and the Operations Dashboard hardcoded values
        
        result = {
            'summary': {
                'three_month_included_cost': 79904.99,
                'three_month_amazon_coverage': 73207.43,
                'three_month_difference': -6697.56,
                'august_difference': -10907.91,
                'note': 'Acura excluded per owner direction. June/July final + August advance. Posting-period comparison; not net profit.'
            },
            'included_fleet_expense_vs_coverage': {
                'june': {
                    'fleet_expense': 21334,
                    'amazon_coverage': 21667,
                    'difference': 332.82
                },
                'july': {
                    'fleet_expense': 25743,
                    'amazon_coverage': 29620,
                    'difference': 3877.53
                },
                'august': {
                    'fleet_expense': 32828,
                    'amazon_coverage': 21920,
                    'difference': -10907.91
                }
            },
            'third_party_rental': {
                'june': {
                    'rental_cost': 11159,
                    'rental_coverage': 726
                },
                'july': {
                    'rental_cost': 15726,
                    'rental_coverage': 2122
                },
                'august': {
                    'rental_cost': 18830,
                    'rental_coverage': 2306
                }
            },
            'lmr_costs': {
                'june': {
                    'lmr_cost': 10015,
                    'amazon_lmr_coverage': 20941
                },
                'july': {
                    'lmr_cost': 10015,
                    'amazon_lmr_coverage': 27498
                },
                'august': {
                    'lmr_cost': 13915,
                    'amazon_lmr_coverage': 19614
                }
            },
            'coverage_differences': {
                'june': 332.82,
                'july': 3877.53,
                'august': -10907.91
            }
        }
        self.send_json(result)

    # ========== Dispute Detection Handlers ==========
    
    def handle_get_disputes(self, query):
        """Return existing disputes."""
        conn = get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                week, driver_id, metric, reason, status, submitted_at, outcome, tba_ids, evidence_sources, priority, appeal_details
            FROM disputes
            ORDER BY week DESC, submitted_at DESC
        """)
        disputes = []
        for row in cursor.fetchall():
            dispute = dict(row)
            # Get driver name
            if dispute['driver_id']:
                cursor.execute("SELECT name FROM drivers WHERE id = ?", (dispute['driver_id'],))
                driver = cursor.fetchone()
                if driver:
                    dispute['driver_name'] = driver['name']
                else:
                    dispute['driver_name'] = 'Unknown'
            else:
                dispute['driver_name'] = 'Unknown'
            disputes.append(dispute)
        
        conn.close()
        self.send_json(disputes)
    
    def handle_get_dispute_candidates(self, query):
        """Return auto-detected dispute candidates."""
        week = query.get('week', ['2026-wk37'])[0]
        
        # Normalize week format: 2026-wk37 -> 2026-W37
        week = week.replace('-wk', '-W')
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get driver performance data for the week
        cursor.execute("""
            SELECT driver_id, dcr, pod, cdf_negatives, dsb_defects, safety_events
            FROM driver_performance
            WHERE week = ?
        """, (week,))
        scorecards = cursor.fetchall()
        
        # Detect dispute candidates
        candidates = []
        for sc in scorecards:
            driver_id = sc['driver_id']
            if not driver_id:
                continue
            cursor.execute("SELECT name FROM drivers WHERE id = ?", (driver_id,))
            driver = cursor.fetchone()
            if not driver:
                continue
            
            # Flag DCR below 99%
            dcr = sc.get('dcr')
            if dcr and dcr < 99.0:
                candidates.append({
                    'week': week,
                    'driver_id': driver_id,
                    'driver_name': driver['name'],
                    'metric': 'DCR',
                    'reason': f"DCR below 99% ({dcr}%)",
                    'evidence': f"Driver performance data for {week}",
                    'confidence': 'High'
                })
            
            # Flag safety events
            safety = sc.get('safety_events')
            if safety and safety > 0:
                candidates.append({
                    'week': week,
                    'driver_id': driver_id,
                    'driver_name': driver['name'],
                    'metric': 'Safety',
                    'reason': f"{safety} safety events",
                    'evidence': f"Driver performance data for {week}",
                    'confidence': 'Medium'
                })
            
            # Flag high DSB defects
            dsb = sc.get('dsb_defects')
            if dsb and dsb > 2:
                candidates.append({
                    'week': week,
                    'driver_id': driver_id,
                    'driver_name': driver['name'],
                    'metric': 'DSB',
                    'reason': f"{dsb} DSB defects",
                    'evidence': f"Driver performance data for {week}",
                    'confidence': 'Medium'
                })
            
            # Flag high CDF negatives
            cdf = sc.get('cdf_negatives')
            if cdf and cdf > 10:
                candidates.append({
                    'week': week,
                    'driver_id': driver_id,
                    'driver_name': driver['name'],
                    'metric': 'CDF',
                    'reason': f"{cdf} CDF negatives",
                    'evidence': f"Driver performance data for {week}",
                    'confidence': 'Medium'
                })
        
        conn.close()
        self.send_json(candidates)

    # ========== Route Monitoring Handlers ==========
    
    def handle_get_route_monitor(self, query):
        """Return route monitoring summary."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get today's routes
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute("""
            SELECT 
                route_code, driver_id, date, stops, packages, status
            FROM amazon_routes
            WHERE date = ?
            ORDER BY route_code
        """, (today,))
        routes = []
        for row in cursor.fetchall():
            route = dict(row)
            # Get driver name
            if route['driver_id']:
                cursor.execute("SELECT name FROM drivers WHERE id = ?", (route['driver_id'],))
                driver = cursor.fetchone()
                if driver:
                    route['driver_name'] = driver['name']
                else:
                    route['driver_name'] = 'Unknown'
            else:
                route['driver_name'] = 'Unknown'
            routes.append(route)
        
        conn.close()
        self.send_json(routes)

    # ========== Payroll Reconciliation Handlers ==========
    
    def handle_get_payroll(self, query):
        """Return payroll reconciliation summary."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get ADP timecards
        cursor.execute("SELECT * FROM adp_timecards")
        timecards = [dict(row) for row in cursor.fetchall()]
        
        # Get Amazon routes
        cursor.execute("SELECT * FROM amazon_routes LIMIT 10")
        routes = [dict(row) for row in cursor.fetchall()]
        
        result = {
            'timecards': timecards,
            'routes': routes
        }
        
        conn.close()
        self.send_json(result)
    
    def handle_get_payroll_discrepancies(self, query):
        """Return payroll discrepancies."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Cross-reference ADP timecards with Amazon routes
        # Use the correct column name: duration_hours, not hat.hours or at.hours
        cursor.execute("""
            SELECT 
                at.driver_id, d.name as driver_name, at.date, at.duration_hours as adp_hours,
                ar.stops, ar.packages, ar.date as route_date
            FROM adp_timecards at
            JOIN drivers d ON at.driver_id = d.id
            LEFT JOIN amazon_routes ar ON at.driver_id = ar.driver_id AND at.date = ar.date
            WHERE at.duration_hours = 0 AND ar.driver_id IS NOT NULL
        """)
        discrepancies = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        self.send_json(discrepancies)

    # ========== PAVE Handlers ==========
    
    def handle_get_pave_vehicles(self, query):
        """Return PAVE vehicle data with all Amazon wear and tear data points."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get all vans with PAVE-related data
        cursor.execute("""
            SELECT 
                v.id, v.van_number, v.vin, v.make, v.model, v.year, v.status, v.ownership, v.notes, v.updated_at,
                p.inspection_date, p.inspector_name, p.overall_score, p.compliance_status, p.pave_status,
                p.exterior_score, p.body_damage, p.scratches_dents, p.rust, p.paint_condition, 
                p.decals_logos, p.lights, p.mirrors, p.windows,
                p.tire_condition, p.tread_depth, p.tire_pressure, p.spare_tire,
                p.interior_score, p.seat_condition, p.floor_mats, p.dashboard, 
                p.steering_wheel, p.pedals, p.cargo_area_cleanliness, p.odor,
                p.mechanical_score, p.engine, p.transmission, p.brakes, p.suspension, 
                p.exhaust, p.fluids, p.battery, p.heating_ac,
                p.fire_extinguisher, p.first_aid_kit, p.reflective_triangles, p.jump_starter,
                p.interior_cleanliness_score, p.exterior_cleanliness_score,
                p.registration_valid, p.insurance_valid, p.dot_inspection_date, 
                p.maintenance_records_up_to_date, p.next_inspection_due, p.notes as pave_notes
            FROM vans v
            LEFT JOIN pave_inspections p ON v.id = p.van_id
            ORDER BY v.van_number
        """)
        rows = cursor.fetchall()
        
        # Transform to the expected format for the dashboard
        vehicles = []
        for row in rows:
            van = dict(row)
            
            # Use PAVE data if available, otherwise determine from van status
            if van.get('overall_score'):
                compliance_status = van.get('compliance_status', 'unknown')
                pave_status = van.get('pave_status', 'grey')
                pave_score = van.get('overall_score', 0)
            elif van['status'] == 'OPERATIONAL':
                compliance_status = 'compliant'
                pave_status = 'green'
                pave_score = 100
            elif van['status'] == 'GROUND':
                compliance_status = 'non-compliant'
                pave_status = 'red'
                pave_score = 0
            else:
                compliance_status = 'unknown'
                pave_status = 'grey'
                pave_score = 50
            
            vehicles.append({
                'vin': van['vin'],
                'licensePlate': van.get('van_number', 'N/A'),
                'vanNumber': van.get('van_number', 'N/A'),
                'make': van.get('make', 'Unknown'),
                'model': van.get('model', 'Unknown'),
                'year': van.get('year'),
                'ownership': van.get('ownership', 'Unknown'),
                'status': van.get('status', 'Unknown'),
                'complianceStatus': compliance_status,
                'paveStatus': pave_status,
                'paveScore': pave_score,
                'lastPaveInspectionDate': van.get('inspection_date', van.get('updated_at', 'N/A')),
                'nextPaveInspectionDue': van.get('next_inspection_due', 'N/A'),
                'inspectorName': van.get('inspector_name', 'N/A'),
                
                # Exterior data points
                'exteriorScore': van.get('exterior_score'),
                'bodyDamage': van.get('body_damage', 'N/A'),
                'scratchesDents': van.get('scratches_dents', 'N/A'),
                'rust': van.get('rust', 'N/A'),
                'paintCondition': van.get('paint_condition', 'N/A'),
                'decalsLogos': van.get('decals_logos', 'N/A'),
                'lights': van.get('lights', 'N/A'),
                'mirrors': van.get('mirrors', 'N/A'),
                'windows': van.get('windows', 'N/A'),
                
                # Tire data points
                'tireCondition': van.get('tire_condition', 'N/A'),
                'treadDepth': van.get('tread_depth'),
                'tirePressure': van.get('tire_pressure', 'N/A'),
                'spareTire': van.get('spare_tire', 'N/A'),
                
                # Interior data points
                'interiorScore': van.get('interior_score'),
                'seatCondition': van.get('seat_condition', 'N/A'),
                'floorMats': van.get('floor_mats', 'N/A'),
                'dashboard': van.get('dashboard', 'N/A'),
                'steeringWheel': van.get('steering_wheel', 'N/A'),
                'pedals': van.get('pedals', 'N/A'),
                'cargoAreaCleanliness': van.get('cargo_area_cleanliness', 'N/A'),
                'odor': van.get('odor', 'N/A'),
                
                # Mechanical data points
                'mechanicalScore': van.get('mechanical_score'),
                'engine': van.get('engine', 'N/A'),
                'transmission': van.get('transmission', 'N/A'),
                'brakes': van.get('brakes', 'N/A'),
                'suspension': van.get('suspension', 'N/A'),
                'exhaust': van.get('exhaust', 'N/A'),
                'fluids': van.get('fluids', 'N/A'),
                'battery': van.get('battery', 'N/A'),
                'heatingAc': van.get('heating_ac', 'N/A'),
                
                # Safety equipment
                'fireExtinguisher': van.get('fire_extinguisher', 'N/A'),
                'firstAidKit': van.get('first_aid_kit', 'N/A'),
                'reflectiveTriangles': van.get('reflective_triangles', 'N/A'),
                'jumpStarter': van.get('jump_starter', 'N/A'),
                
                # Cleanliness scores
                'interiorCleanlinessScore': van.get('interior_cleanliness_score'),
                'exteriorCleanlinessScore': van.get('exterior_cleanliness_score'),
                
                # Documentation
                'registrationValid': van.get('registration_valid', 'N/A'),
                'insuranceValid': van.get('insurance_valid', 'N/A'),
                'dotInspectionDate': van.get('dot_inspection_date', 'N/A'),
                'maintenanceRecordsUpToDate': van.get('maintenance_records_up_to_date', 'N/A'),
                
                # Notes
                'paveNotes': van.get('pave_notes', van.get('notes', ''))
            })
        
        result = {
            'total': len(vehicles),
            'items': vehicles
        }
        
        conn.close()
        self.send_json(result)
    
    # ========== File Serving Handlers ==========
    
    def handle_dashboard_html(self):
        """Serve the main dashboard HTML."""
        if not DASHBOARD_PATH.exists():
            self.send_error(404, "Dashboard not found")
            return
        
        with open(DASHBOARD_PATH, 'rb') as f:
            content = f.read()
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)
    
    def handle_form_html(self):
        """Serve the daily entry form HTML."""
        form_path = ROOT / "data/dashboards/daily-entry-form.html"
        if not form_path.exists():
            self.send_error(404, "Form not found")
            return
        
        with open(form_path, 'rb') as f:
            content = f.read()
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)
    
    def handle_dashboard_file(self):
        """Serve static files from the dashboard directory."""
        parsed = urllib.parse.urlparse(self.path)
        file_path = DASHBOARD_DIR / parsed.path.lstrip('/data/dashboards/')
        
        if file_path.exists() and file_path.is_file():
            with open(file_path, 'rb') as f:
                content = f.read()
            
            content_type = 'text/html'
            if self.path.endswith('.css'):
                content_type = 'text/css'
            elif self.path.endswith('.js'):
                content_type = 'application/javascript'
            elif self.path.endswith('.json'):
                content_type = 'application/json'
            
            self.send_response(200)
            self.send_header('Content-Type', content_type + '; charset=utf-8')
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, f"File not found: {self.path}")
    
    def handle_redirect_to_dashboard(self):
        """Redirect to the main dashboard."""
        self.send_response(302)
        self.send_header('Location', '/amazon-dsp-kpi-dashboard.html')
        self.end_headers()
    
    def send_json(self, data):
        """Send JSON response."""
        content = json.dumps(data, default=str).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(content))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(content)


def run_server(port=8000):
    """Run the JECS API server."""
    server_address = ('', port)
    httpd = HTTPServer(server_address, JecsAPIHandler)
    print(f"JECS API server running on http://localhost:{port}")
    print(f"Open the dashboard at: http://localhost:{port}/amazon-dsp-kpi-dashboard.html")
    print("Press Ctrl+C to stop the server")
    httpd.serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='JECS Unified API Server')
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on (default: 8000)')
    args = parser.parse_args()
    run_server(args.port)
