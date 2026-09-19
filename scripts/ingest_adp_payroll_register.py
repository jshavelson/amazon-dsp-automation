#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


HOUR_COLUMNS = {
    'regular': 'RG HRS',
    'overtime': 'OT HRS',
    'bonus_hours': 'HRS 3 BNH',
    'bonus': 'HRS 3 BNS',
    'leave': 'HRS 3 LK1',
    'pto': 'HRS 3 PTO',
    'training': 'HRS 3 TRA',
}
EARNING_COLUMNS = {
    'regular': 'RG ERN',
    'overtime': 'OT ERN',
    'bonus_hours': 'ERN 3 BNH',
    'bonus': 'ERN 3 BNS',
    'leave': 'ERN 3 LK1',
    'pto': 'ERN 3 PTO',
    'training': 'ERN 3 TRA',
}
REQUIRED_COLUMNS = {'FILE NBR', *HOUR_COLUMNS.values(), *EARNING_COLUMNS.values()}
SPECIAL_CODES = {
    'BNH': 'bonus_hours',
    'BNS': 'bonus',
    'LK1': 'leave',
    'PTO': 'pto',
    'TRA': 'training',
}


def decimal_value(value: str | None) -> Decimal:
    raw = (value or '').strip().replace(',', '')
    if not raw:
        return Decimal('0')
    try:
        return Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError(f'Invalid numeric payroll value {raw!r}') from exc


def exact(value: Decimal) -> str:
    return format(value, 'f')


def percentage(numerator: Decimal, denominator: Decimal) -> Decimal:
    return Decimal('0') if denominator == 0 else (numerator / denominator * 100).quantize(Decimal('0.0001'))


def summarize_employees(
    employees: dict[str, dict[str, object]], source_row_count: int
) -> tuple[list[dict[str, object]], dict[str, object]]:
    minimized: list[dict[str, object]] = []
    totals_hours: defaultdict[str, Decimal] = defaultdict(Decimal)
    totals_earnings: defaultdict[str, Decimal] = defaultdict(Decimal)
    employees_with_ot = 0
    for file_number in sorted(employees, key=lambda value: (len(value), value)):
        employee = employees[file_number]
        hours = {key: exact(value) for key, value in employee['hours'].items()}
        earnings = {key: exact(value) for key, value in employee['earnings'].items()}
        for key, value in employee['hours'].items():
            totals_hours[key] += value
        for key, value in employee['earnings'].items():
            totals_earnings[key] += value
        if employee['hours']['overtime'] or employee['earnings']['overtime']:
            employees_with_ot += 1
        minimized.append({
            'payroll_file_number': employee['payroll_file_number'],
            'department': employee['department'],
            'location': employee['location'],
            'hours': hours,
            'earnings': earnings,
        })

    summary = {
        'source_row_count': source_row_count,
        'employee_count': len(minimized),
        'employees_with_overtime': employees_with_ot,
        'hours': {key: exact(value) for key, value in totals_hours.items()},
        'earnings': {key: exact(value) for key, value in totals_earnings.items()},
        'overtime_hours_pct_of_regular': exact(percentage(totals_hours['overtime'], totals_hours['regular'])),
        'overtime_pay_pct_of_regular': exact(percentage(totals_earnings['overtime'], totals_earnings['regular'])),
        'overtime_hours_pct_of_total_regular_plus_ot': exact(percentage(
            totals_hours['overtime'], totals_hours['regular'] + totals_hours['overtime']
        )),
        'overtime_pay_pct_of_total_regular_plus_ot': exact(percentage(
            totals_earnings['overtime'], totals_earnings['regular'] + totals_earnings['overtime']
        )),
    }
    return minimized, summary


def parse_csv_register(path: Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    employees: dict[str, dict[str, object]] = {}
    row_count = 0
    with path.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f'Missing required payroll columns: {", ".join(sorted(missing))}')
        for row in reader:
            row_count += 1
            file_number = (row.get('FILE NBR') or '').strip()
            if not file_number:
                continue
            employee = employees.setdefault(file_number, {
                'payroll_file_number': file_number,
                'department': (row.get('DEPT') or '').strip() or None,
                'location': (row.get('LOC') or '').strip() or None,
                'hours': defaultdict(Decimal),
                'earnings': defaultdict(Decimal),
            })
            for label, column in HOUR_COLUMNS.items():
                employee['hours'][label] += decimal_value(row.get(column))
            for label, column in EARNING_COLUMNS.items():
                employee['earnings'][label] += decimal_value(row.get(column))

    return summarize_employees(employees, row_count)


def numeric_cell(value: object) -> Decimal | None:
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    raw = str(value or '').strip().replace(',', '')
    if not re.fullmatch(r'-?\d+(?:\.\d+)?', raw):
        return None
    return Decimal(raw)


def special_cell(value: object) -> tuple[str, Decimal] | None:
    match = re.fullmatch(r'([A-Z0-9$]+)\s+(-?[\d,]+(?:\.\d+)?)', str(value or '').strip())
    if not match:
        return None
    code = match.group(1)
    if code not in SPECIAL_CODES:
        raise ValueError(f'Unsupported special payroll code {code!r}')
    return SPECIAL_CODES[code], Decimal(match.group(2).replace(',', ''))


def parse_xls_register(path: Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError('Legacy .xls ingestion requires xlrd>=2.0') from exc

    workbook = xlrd.open_workbook(path, on_demand=True)
    sheet = workbook.sheet_by_name('Payroll Register')
    employees: dict[str, dict[str, object]] = {}
    current: dict[str, object] | None = None
    employee_rows = 0

    for row_index in range(sheet.nrows):
        personnel = str(sheet.cell_value(row_index, 0) or '')
        identity = re.search(r'File #:\s*(\d+)', personnel)
        if identity:
            file_number = identity.group(1)
            department_match = re.search(r'H Dept:\s*(\d+)', personnel)
            current = employees.setdefault(file_number, {
                'payroll_file_number': file_number,
                'department': department_match.group(1) if department_match else None,
                'location': None,
                'hours': defaultdict(Decimal),
                'earnings': defaultdict(Decimal),
            })
            employee_rows += 1
        elif personnel.startswith(('Dept. Total', 'Paid-In Department')):
            current = None

        if current is None:
            continue

        for column, label in ((1, 'regular'), (2, 'overtime')):
            value = numeric_cell(sheet.cell_value(row_index, column))
            if value is not None:
                current['hours'][label] += value
        for column, label in ((4, 'regular'), (5, 'overtime')):
            value = numeric_cell(sheet.cell_value(row_index, column))
            if value is not None:
                current['earnings'][label] += value
        for column in (3,):
            value = special_cell(sheet.cell_value(row_index, column))
            if value:
                label, amount = value
                current['hours'][label] += amount
        for column in (6, 7):
            value = special_cell(sheet.cell_value(row_index, column))
            if value:
                label, amount = value
                current['earnings'][label] += amount

    return summarize_employees(employees, employee_rows)


def parse_register(path: Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    if path.suffix.lower() == '.xls':
        return parse_xls_register(path)
    return parse_csv_register(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)


def ingest(path: Path, output_dir: Path, period_start: str, period_end: str, check_date: str | None) -> dict[str, object]:
    employees, summary = parse_register(path)
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)
    provenance = {
        'source': 'ADP Workforce Now Payroll Register',
        'source_format': path.suffix.lower().lstrip('.'),
        'source_filename': path.name,
        'source_sha256': sha256(path),
        'ingested_at': datetime.now(timezone.utc).isoformat(),
        'pay_period': {'start_date': period_start, 'end_date': period_end},
        'check_date': check_date,
        'retained_fields': [
            'payroll_file_number', 'department', 'location',
            'regular/overtime/special-category hours',
            'regular/overtime/special-category earnings',
        ],
        'discarded_field_classes': [
            'employee name', 'SSN', 'taxes', 'deductions', 'banking/check identifiers',
            'net pay', 'tax profile', 'memo calculations',
        ],
    }
    payload = {**provenance, **summary}
    write_json(output_dir / 'employee-earnings.min.json', employees)
    write_json(output_dir / 'summary.json', payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description='Minimize and summarize an ADP Payroll Register CSV or legacy XLS.')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--period-start', required=True)
    parser.add_argument('--period-end', required=True)
    parser.add_argument('--check-date')
    args = parser.parse_args()
    result = ingest(args.input, args.output_dir, args.period_start, args.period_end, args.check_date)
    print(json.dumps({
        'pay_period': result['pay_period'],
        'employee_count': result['employee_count'],
        'employees_with_overtime': result['employees_with_overtime'],
        'regular_hours': result['hours']['regular'],
        'overtime_hours': result['hours']['overtime'],
        'regular_earnings': result['earnings']['regular'],
        'overtime_earnings': result['earnings']['overtime'],
        'overtime_hours_pct_of_regular': result['overtime_hours_pct_of_regular'],
        'overtime_pay_pct_of_regular': result['overtime_pay_pct_of_regular'],
    }, indent=2))


if __name__ == '__main__':
    main()
