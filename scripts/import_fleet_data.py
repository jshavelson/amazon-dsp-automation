#!/usr/bin/env python3
"""
Import fleet data from vehicles-1.json into the vans table.

Usage:
    python3 scripts/import_fleet_data.py
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"
FLEET_FILE = ROOT / "data/fleet_reviews/2026-09-07/vehicles-1.json"


def import_fleet_data():
    """Import fleet data from vehicles-1.json into the vans table."""
    if not FLEET_FILE.exists():
        print(f"Fleet file not found: {FLEET_FILE}")
        return
    
    with open(FLEET_FILE, 'r') as f:
        data = json.load(f)
    
    vehicles = data.get('data', {}).get('vehicles', [])
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Clear existing vans
    cursor.execute("DELETE FROM vans")
    
    imported = 0
    for vehicle in vehicles:
        vin = vehicle.get('vin')
        dsp_vehicle_id = vehicle.get('dspVehicleId')
        make = vehicle.get('make')
        model = vehicle.get('model')
        year = vehicle.get('year')
        ownership = vehicle.get('vehicleOwnershipType')
        status = vehicle.get('operationalStatus')
        
        # Use dspVehicleId as the van_number, VIN as the id
        van_id = vin or dsp_vehicle_id
        van_number = dsp_vehicle_id or vin
        
        if not van_id:
            continue
        
        cursor.execute("""
            INSERT INTO vans (
                id, van_number, vin, make, model, year, status, ownership, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            van_id,
            van_number,
            vin,
            make,
            model,
            year,
            status,
            ownership,
            f"Source: {FLEET_FILE.name}"
        ))
        imported += 1
    
    conn.commit()
    conn.close()
    
    print(f"Imported {imported} vans into the database")


if __name__ == '__main__':
    import_fleet_data()
