#!/usr/bin/env python3
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/dsp_operations.db"

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Get all vans
cursor.execute("SELECT id, vin FROM vans")
vans = cursor.fetchall()

pave_data = [
    # van_id, vin, inspection_date, inspector, overall_score, compliance_status, pave_status
    # exterior: body_damage, scratches_dents, rust, paint_condition, decals_logos, lights, mirrors, windows
    # tires: tire_condition, tread_depth, tire_pressure, spare_tire
    # interior: interior_score, seat_condition, floor_mats, dashboard, steering_wheel, pedals, cargo_area, odor
    # mechanical: mechanical_score, engine, transmission, brakes, suspension, exhaust, fluids, battery, heating_ac
    # safety: fire_extinguisher, first_aid_kit, reflective_triangles, jump_starter
    # cleanliness: interior_clean_score, exterior_clean_score
    # docs: registration_valid, insurance_valid, dot_date, maintenance_up_to_date, next_due, notes
    
    ('3C6LRVDG7TE179292', '3C6LRVDG7TE179292', '2026-09-15', 'John Smith', 92, 'compliant', 'green',
     'None', 'Minor', 'None', 'Good', 'Present', 'All working', 'Clean', 'N/A',
     'Good', 10.5, 'Normal', 'Present',
     88, 'Good', 'Clean', 'Clean', 'Good', 'Clean', 'Good', 'None',
     90, 'Good', 'Good', 'Good', 'Good', 'Good', 'Good', 'Good', 'Good',
     'Present', 'Present', 'Present', 'Present',
     95, 98, 'Yes', 'Yes', '2026-08-15', 'Yes', '2026-10-15', 'Regular maintenance up to date'),
    
    ('7FCEHEB20RN026201', '7FCEHEB20RN026201', '2026-09-18', 'Mike Johnson', 45, 'non-compliant', 'red',
     'Minor', 'Major', 'None', 'Faded', 'Present', 'Left broken', 'Clean', 'N/A',
     'Worn', 8.0, 'Low', 'Missing',
     75, 'Worn', 'Dirty', 'Dirty', 'Good', 'Dirty', 'Good', 'Musty',
     50, 'Needs service', 'Good', 'Worn', 'Good', 'Good', 'Low', 'Weak', 'Good',
     'Missing', 'Present', 'Present', 'Missing',
     60, 70, 'Yes', 'Yes', '2026-07-15', 'No', '2026-09-18', 'Grounded - window/electrical issue per 9/16 alert'),
    
    ('3C6MRVHG3SE546234', '3C6MRVHG3SE546234', '2026-09-10', 'Sarah Williams', 88, 'compliant', 'yellow',
     'None', 'Minor', 'None', 'Good', 'Present', 'All working', 'Clean', 'N/A',
     'Good', 11.0, 'Normal', 'Present',
     90, 'Good', 'Clean', 'Clean', 'Good', 'Clean', 'Good', 'None',
     92, 'Good', 'Good', 'Good', 'Good', 'Good', 'Good', 'Good', 'Good',
     'Present', 'Present', 'Present', 'Present',
     90, 95, 'Yes', 'Yes', '2026-09-01', 'Yes', '2026-12-10', 'Minor oil leak noted'),
]

for row in pave_data:
    cursor.execute("""
        INSERT OR IGNORE INTO pave_inspections (
            van_id, vin, inspection_date, inspector_name, overall_score, compliance_status, pave_status,
            body_damage, scratches_dents, rust, paint_condition, decals_logos, lights, mirrors, windows,
            tire_condition, tread_depth, tire_pressure, spare_tire,
            interior_score, seat_condition, floor_mats, dashboard, steering_wheel, pedals, cargo_area_cleanliness, odor,
            mechanical_score, engine, transmission, brakes, suspension, exhaust, fluids, battery, heating_ac,
            fire_extinguisher, first_aid_kit, reflective_triangles, jump_starter,
            interior_cleanliness_score, exterior_cleanliness_score,
            registration_valid, insurance_valid, dot_inspection_date, maintenance_records_up_to_date, next_inspection_due, notes
        ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?)
    """, row)

conn.commit()
conn.close()
print(f"Inserted {len(pave_data)} PAVE inspection records")
