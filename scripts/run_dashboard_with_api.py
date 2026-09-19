#!/usr/bin/env python3
"""
Reverse Proxy Server for JECS Dashboard + API.

This server:
1. Serves static files from data/dashboards/ (like the existing http.server)
2. Proxies /api/... requests to localhost:8000 (where daily_entry_api.py runs)

Usage:
    # Terminal 1: Start the API server
    python3 scripts/daily_entry_api.py --port 8000
    
    # Terminal 2: Start the reverse proxy server
    python3 scripts/run_dashboard_with_api.py
    
Then open: http://localhost:8443/amazon-dsp-kpi-dashboard.html
"""

import json
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "data/dashboards"
API_PROXY_URL = "http://localhost:8000"


class DashboardProxyHandler(BaseHTTPRequestHandler):
    """Serve dashboard files and proxy API requests."""
    
    def log_message(self, format, *args):
        """Suppress default logging."""
        pass
    
    def do_GET(self):
        """Handle GET requests for dashboard files and API proxy."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = parsed.query
        
        # Proxy /api/... requests to the API server on port 8000
        if path.startswith('/api/'):
            self.proxy_to_api()
            return
        
        # Serve static files from dashboard directory
        self.serve_static_file()
    
    def do_POST(self):
        """Handle POST requests for API proxy."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        if path.startswith('/api/'):
            self.proxy_to_api(method='POST')
            return
        
        self.send_error(404, f"Not found: {path}")
    
    def do_OPTIONS(self):
        """Handle OPTIONS for CORS."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def proxy_to_api(self, method='GET'):
        """Proxy request to the API server on port 8000."""
        try:
            # Build the API URL
            api_url = API_PROXY_URL + self.path
            if self.path == '/api/daily-entries' and method == 'POST':
                # Handle POST with body
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                
                req = urllib.request.Request(
                    api_url,
                    data=body,
                    method=method,
                    headers={'Content-Type': self.headers.get('Content-Type', 'application/json')}
                )
            else:
                req = urllib.request.Request(api_url, method=method)
            
            with urllib.request.urlopen(req) as response:
                # Copy response status
                self.send_response(response.status)
                
                # Copy response headers
                for header, value in response.getheaders():
                    if header.lower() != 'transfer-encoding':
                        self.send_header(header, value)
                
                # Add CORS headers
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                
                self.end_headers()
                self.wfile.write(response.read())
        except Exception as e:
            self.send_error(502, f"API Proxy Error: {str(e)}")
    
    def serve_static_file(self):
        """Serve static files from the dashboard directory."""
        # Map paths to files
        path = self.path
        if path == '/' or path == '':
            path = '/amazon-dsp-kpi-dashboard.html'
        
        # Try to find the file
        file_path = DASHBOARD_DIR / path.lstrip('/')
        
        if file_path.exists() and file_path.is_file():
            with open(file_path, 'rb') as f:
                content = f.read()
            
            # Set content type based on extension
            content_type = 'text/html'
            if path.endswith('.css'):
                content_type = 'text/css'
            elif path.endswith('.js'):
                content_type = 'application/javascript'
            elif path.endswith('.json'):
                content_type = 'application/json'
            elif path.endswith('.png'):
                content_type = 'image/png'
            elif path.endswith('.jpg') or path.endswith('.jpeg'):
                content_type = 'image/jpeg'
            
            self.send_response(200)
            self.send_header('Content-Type', content_type + '; charset=utf-8')
            self.send_header('Content-Length', len(content))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, f"File not found: {path}")


def run_server(port=8443):
    """Run the reverse proxy server."""
    server_address = ('', port)
    
    # Check if port is available
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(server_address)
    except OSError as e:
        print(f"Port {port} is already in use: {e}")
        print(f"Try running the API server directly on a different port:")
        print(f"  python3 scripts/daily_entry_api.py --port 8000")
        print(f"Then access the form at: http://localhost:8000/data/dashboards/daily-entry-form.html")
        return
    
    httpd = HTTPServer(server_address, DashboardProxyHandler)
    print(f"Dashboard + API Proxy server running on http://localhost:{port}")
    print(f"Serving files from: {DASHBOARD_DIR}")
    print(f"Proxying /api/... to: {API_PROXY_URL}")
    print(f"Open the dashboard at: http://localhost:{port}/amazon-dsp-kpi-dashboard.html")
    print(f"Press Ctrl+C to stop the server")
    httpd.serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Dashboard + API Proxy Server')
    parser.add_argument('--port', type=int, default=8443, help='Port to run the server on (default: 8443)')
    args = parser.parse_args()
    run_server(args.port)
