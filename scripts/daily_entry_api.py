#!/usr/bin/env python3
"""
Daily Entry API Server for JECS DSP Operations.

Provides endpoints for the editable daily form:
- GET /api/drivers - List all drivers
- GET /api/vans - List all vans
- GET /api/daily-entries?date=YYYY-MM-DD - Get entries for a date
- POST /api/daily-entries - Save entries (auto-save)
- GET /api/daily-entries/history?date=YYYY-MM-DD - Get history for a date
- POST /api/daily-entries/revert?history_id=X - Revert to a history entry

Usage:
    python3 scripts/daily_entry_api.py
    
Then open: http://localhost:8000/data/dashboards/daily-entry-form.html
"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"
FORM_PATH = ROOT / "data/dashboards/daily-entry-form.html"
DASHBOARD_PATH = ROOT / "data/dashboards/amazon-dsp-kpi-dashboard.html"


def get_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


class DailyEntryAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for daily entry API."""
    
    def log_message(self, format, *args):
        """Suppress default logging."""
        pass
    
    def do_GET(self):
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        
        try:
            if path == '/api/drivers':
                self.handle_get_drivers()
            elif path == '/api/vans':
                self.handle_get_vans()
            elif path == '/api/daily-entries':
                self.handle_get_daily_entries(query)
            elif path == '/api/daily-entries/history':
                self.handle_get_history(query)
            elif path == '/data/dashboards/daily-entry-form.html':
                self.handle_form_html()
            elif path == '/amazon-dsp-kpi-dashboard.html':
                self.handle_dashboard_html()
            elif path == '/' or path == '/daily-entry':
                self.handle_redirect_to_form()
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
        
        # Get entries for this date with driver and van info
        cursor.execute("""
            SELECT 
                de.id, de.driver_id, d.name as driver_name,
                de.van_id, v.van_number, v.id as van_id,
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
        
        # Track history
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
                # Record deletion in history
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
                
                # Delete the entry
                cursor.execute("DELETE FROM daily_route_entries WHERE id = ?", (entry_id,))
            elif entry_id and entry_id != 'new':
                # Update existing entry
                cursor.execute("""
                    SELECT de.*, d.name as driver_name, v.van_number 
                    FROM daily_route_entries de
                    LEFT JOIN drivers d ON de.driver_id = d.id
                    LEFT JOIN vans v ON de.van_id = v.id
                    WHERE de.id = ?
                """, (entry_id,))
                old_entry = cursor.fetchone()
                if old_entry:
                    # Record old state in history
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
                
                # Update the entry
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
                # Insert new entry
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
                
                # Record creation in history
                history_entries.append({
                    'entry_id': entry_id,
                    'driver_id': driver_id,
                    'driver_name': '',  # Will be populated on next load
                    'van_id': van_id,
                    'van_number': '',  # Will be populated on next load
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
        
        # Insert history records
        for history in history_entries:
            cursor.execute("""
                INSERT INTO daily_entries_history (
                    entry_id, driver_id, driver_name, van_id, van_number,
                    route_code, date, stops, packages, status, start_time, end_time,
                    notes, changed_by, change_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        
        # Return updated entries
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
    
    def handle_post_revert(self, query):
        """Revert to a specific history entry."""
        history_id = query.get('history_id', [None])[0]
        if not history_id:
            self.send_error(400, "Missing history_id parameter")
            return
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Get the history entry
        cursor.execute("SELECT * FROM daily_entries_history WHERE id = ?", (history_id,))
        history = cursor.fetchone()
        if not history:
            self.send_error(404, "History entry not found")
            return
        
        # Revert the entry
        if history['change_type'] == 'delete':
            # Restore deleted entry
            cursor.execute("""
                INSERT INTO daily_route_entries (
                    id, driver_id, van_id, route_code, date, stops, packages,
                    status, start_time, end_time, notes, entered_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                history['entry_id'], history['driver_id'], history['van_id'],
                history['route_code'], history['date'], history['stops'], history['packages'],
                history['status'], history['start_time'], history['end_time'],
                history['notes'], 'reverted'
            ))
        else:
            # Restore previous state
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
        
        # Record the revert in history
        cursor.execute("""
            INSERT INTO daily_entries_history (
                entry_id, driver_id, driver_name, van_id, van_number,
                route_code, date, stops, packages, status, start_time, end_time,
                notes, changed_by, change_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    
    def handle_form_html(self):
        """Serve the daily entry form HTML."""
        if not FORM_PATH.exists():
            self.send_error(404, "Form not found")
            return
        
        with open(FORM_PATH, 'rb') as f:
            content = f.read()
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)
    
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
    
    def handle_redirect_to_form(self):
        """Redirect to the daily entry form."""
        self.send_response(302)
        self.send_header('Location', '/data/dashboards/daily-entry-form.html')
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
    
    def do_OPTIONS(self):
        """Handle OPTIONS for CORS."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


def run_server(port=8443):
    """Run the daily entry API server."""
    server_address = ('', port)
    httpd = HTTPServer(server_address, DailyEntryAPIHandler)
    print(f"Daily Entry API server running on http://localhost:{port}")
    print(f"Open the dashboard at: http://localhost:{port}/amazon-dsp-kpi-dashboard.html")
    print(f"Open the form at: http://localhost:{port}/data/dashboards/daily-entry-form.html")
    print("Press Ctrl+C to stop the server")
    httpd.serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Daily Entry API Server')
    parser.add_argument('--port', type=int, default=8443, help='Port to run the server on (default: 8443)')
    args = parser.parse_args()
    run_server(args.port)
