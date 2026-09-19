#!/usr/bin/env python3
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
import statistics
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from shutil import move
import xml.etree.ElementTree as ET
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parent.parent
NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}


def usage() -> None:
    print('Usage: evaluate_week.py <week-folder> [--force true|false] [--render-pdf true|false] [--dry-run true|false] [--include-repeat-driver true|false] [--include-dispute-review true|false] [--include-monitor true|false] [--include-business-closed-timing true|false] [--include-pickup-evidence true|false] [--monitor-lookback N] [--max-dispute-candidates N] [--max-dispute-review-candidates N]', file=sys.stderr)


def parse_args(argv: list[str]) -> tuple[Path, dict[str, str | bool]]:
    if len(argv) < 2:
        usage()
        raise SystemExit(1)
    week_folder = Path(argv[1]).resolve()
    args: dict[str, str | bool] = {}
    i = 2
    while i < len(argv):
        key = argv[i]
        if not key.startswith('--'):
            raise SystemExit(f'Unexpected argument: {key}')
        value: str | bool = True
        if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
            value = argv[i + 1]
            i += 1
        args[key[2:]] = value
        i += 1
    return week_folder, args


def parse_bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() == 'true'


def parse_int(value: str | bool | None, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    try:
        return int(str(value).strip())
    except ValueError:
        return default


BUSINESS_CLOSED_SCHEDULE_GRACE_MINUTES = 0


def parse_clock_time(value: str) -> dt.time | None:
    text = value.strip()
    if not text:
        return None
    normalized = re.sub(r'\s+', ' ', text.upper().replace('.', '')).strip()
    for fmt in ('%I:%M %p', '%I %p', '%H:%M', '%H%M'):
        try:
            return dt.datetime.strptime(normalized, fmt).time()
        except ValueError:
            continue
    return None


def format_clock_time(value: dt.time | None) -> str:
    if value is None:
        return 'unknown time'
    return value.strftime('%-I:%M %p')


def minutes_since_midnight(value: dt.time) -> int:
    return value.hour * 60 + value.minute


def load_business_closed_timing_evidence(week_folder: Path, week_num: str) -> tuple[dict[str, dict[str, str]], Path | None]:
    candidates = [
        week_folder / 'dispute' / f'week{week_num}-business-closed-timing.csv',
        week_folder / f'week{week_num}-business-closed-timing.csv',
    ]
    for path in candidates:
        if not path.is_file():
            continue
        rows_by_tba: dict[str, dict[str, str]] = {}
        for row in read_csv_rows(path):
            tracking_id = (row.get('tracking_id') or row.get('Tracking ID') or '').strip()
            if tracking_id:
                rows_by_tba[tracking_id] = row
        return rows_by_tba, path
    return {}, None


def load_pickup_stop_evidence(week_folder: Path, week_num: str) -> tuple[dict[str, list[dict[str, str]]], Path | None]:
    candidates = [
        week_folder / 'dispute' / f'week{week_num}-pickup-evidence.csv',
        week_folder / f'week{week_num}-pickup-evidence.csv',
    ]
    for path in candidates:
        if not path.is_file():
            continue
        rows_by_id: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in read_csv_rows(path):
            transporter_id = (row.get('transporter_id') or row.get('Transporter ID') or '').strip()
            if transporter_id:
                rows_by_id[transporter_id].append(row)
        for rows in rows_by_id.values():
            rows.sort(key=lambda row: (
                row.get('delivery_date', ''),
                row.get('route_code', ''),
                to_int(row.get('stop_sequence')),
                row.get('tracking_id', ''),
            ))
        return dict(rows_by_id), path
    return {}, None


def pickup_stop_key(row: dict[str, str]) -> tuple[str, str, str, str]:
    """Group package-level pickup tasks into one physical route stop."""
    return (
        (row.get('delivery_date') or '').strip(),
        (row.get('route_id') or row.get('route_code') or '').strip(),
        (row.get('stop_sequence') or '').strip(),
        (row.get('stop_address_id') or row.get('stop_reference') or '').strip(),
    )


def pickup_stop_label(rows: list[dict[str, str]]) -> str:
    row = rows[0]
    delivery_date = (row.get('delivery_date') or '').strip() or 'unknown-date'
    route_code = (row.get('route_code') or row.get('route_id') or '').strip() or 'unknown-route'
    stop_sequence = (row.get('stop_sequence') or '').strip() or '?'
    address_id = (row.get('stop_address_id') or '').strip()
    return f'{delivery_date} {route_code} stop {stop_sequence}' + (f' ({address_id})' if address_id else '')


def classify_pickup_disputability(rows: list[dict[str, str]], failed_stops: int) -> dict[str, object]:
    stop_groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        stop_groups[pickup_stop_key(row)].append(row)
    unique_stops = list(stop_groups.values())
    stop_labels = [pickup_stop_label(group) for group in unique_stops]
    exact_match = failed_stops > 0 and len(unique_stops) == failed_stops
    exact_stop_labels = stop_labels if exact_match else []

    station_object_missing = [
        row for row in rows
        if (row.get('stop_sequence') or '').strip() == '1'
        and (row.get('task_state_context') or '').strip().upper() == 'OBJECT_MISSING'
    ]
    out_of_return_labels = [
        row for row in rows
        if (row.get('task_state_context') or '').strip().upper() == 'OUT_OF_LABELS'
    ]
    customer_unavailable = [
        row for row in rows
        if (row.get('task_state_context') or '').strip().upper() == 'CUSTOMER_UNAVAILABLE'
    ]
    attempted_rows = [
        row for row in rows
        if (row.get('execution_status') or '').strip().upper() == 'ATTEMPTED'
    ]

    reasoning: list[str] = [
        f'Official PSB summary shows {failed_stops} failed stop(s). Live Execution captured {len(rows)} failed pickup task(s) grouped into {len(unique_stops)} unique physical stop(s).'
    ]
    internal_prep: list[str] = [
        'reconcile the official PSB failed stop to one exact portal stop before any submission',
        'keep non-matching candidate pickup events in coaching / process review unless they are proven to be the scored stop',
    ]
    wording = (
        'Hold submission until the exact scored PSB stop is matched to one portal event, then test only the guide-backed '
        'reasons of incorrect geo-location / process-data error, late dispatch, large-scale event, or network down.'
    )
    disputable = 'No clean PSB dispute angle has been confirmed yet.'

    if exact_match:
        reasoning.append(
            f'The official failed-stop count matches the unique Execution stop count; reconciled stop(s): {", ".join(exact_stop_labels)}.'
        )
        internal_prep[0] = 'verify the reconciled stop ID and screenshot against the portal before submission'
    elif unique_stops:
        reasoning.append(
            f'The counts do not reconcile: {len(unique_stops)} Execution stop(s) compete for {failed_stops} official failed stop(s). Candidate stops: {", ".join(stop_labels)}.'
        )

    if station_object_missing:
        disputable = (
            'Most arguable lane: the stop-1 station-origin OBJECT_MISSING event(s) may support an incorrect geo-location '
            'or process/data-error narrative after the exact scored stop is reconciled.'
        )
        reasoning.append(
            'The strongest candidate event is a stop-1 station-origin OBJECT_MISSING pickup, which points more to launch/station attribution than a field execution miss.'
        )
        internal_prep.append('capture the stop-1 station screenshot and any launch / dispatch note that ties the scored stop to station origin')
        wording = (
            'If the scored PSB stop reconciles to the station-origin stop-1 OBJECT_MISSING event, request review under '
            'incorrect geo-location / process or data error because the failure was recorded at station launch rather than as a true in-field pickup miss.'
        )

    if attempted_rows:
        reasoning.append(
            f'Execution marked {len(attempted_rows)} captured event(s) as ATTEMPTED, which supports attempted pickup behavior but does not prove which event drove the official PSB score.'
        )

    if out_of_return_labels:
        reasoning.append('Out of return labels is a direct PSB defect in the SOP and is not a clean dispute reason by itself.')
        internal_prep.append('treat any out-of-return-label event as coaching / station-label process unless Amazon confirms it is not the scored stop')

    if customer_unavailable:
        reasoning.append('Customer unavailable does not map cleanly to the allowed PSB dispute reasons, so it is a weak filing angle unless another guide-backed reason is proven.')
        internal_prep.append('do not lead a PSB filing with customer unavailable unless a separate allowed reason is documented')

    return {
        'captured_rows': len(rows),
        'captured_stops': len(unique_stops),
        'stop_labels': stop_labels,
        'exact_stop_match': exact_match,
        'exact_stop_labels': exact_stop_labels,
        'attempted_rows': len(attempted_rows),
        'station_object_missing_rows': len(station_object_missing),
        'disputable_read': disputable,
        'validation_reason': ' '.join(reasoning),
        'recommended_wording': wording,
        'internal_prep': internal_prep,
    }


def summarize_pickup_rts_rows(rts_rows: list[dict[str, str]], driver_name: str, transporter_id: str) -> list[str]:
    related_rows = [
        row for row in rts_rows
        if (row.get('Transporter ID') or '').strip() == transporter_id
        or (row.get('Delivery Associate ') or '').strip() == driver_name
    ]
    if not related_rows:
        return ['No related RTS rows were found for this driver in the week export.']

    lines: list[str] = []
    contact_rows = [
        row for row in related_rows
        if 'contact' in ' '.join([
            (row.get('Additional Information') or '').strip().lower(),
            (row.get('Exemption Reason') or '').strip().lower(),
        ])
    ]
    if contact_rows:
        for row in contact_rows[:5]:
            detail_bits = [
                (row.get('Planned Delivery Date') or '').strip(),
                (row.get('Tracking ID') or '').strip(),
                titleize_token_text((row.get('DA Selected RTS Code') or '').strip()) or 'Unknown RTS code',
            ]
            if (row.get('Impact DCR') or '').strip():
                detail_bits.append(f"Impact DCR {(row.get('Impact DCR') or '').strip()}")
            if (row.get('Additional Information') or '').strip():
                detail_bits.append((row.get('Additional Information') or '').strip())
            if (row.get('Exemption Reason') or '').strip():
                detail_bits.append((row.get('Exemption Reason') or '').strip())
            lines.append(', '.join(bit for bit in detail_bits if bit))
    else:
        lines.append('No explicit contact compliance notes were logged for this driver in week RTS.')

    pattern_counts: Counter[tuple[str, str, str, str]] = Counter()
    for row in related_rows:
        pattern_counts[(
            (row.get('DA Selected RTS Code') or '').strip(),
            (row.get('Impact DCR') or '').strip(),
            (row.get('Exemption Reason') or '').strip(),
            (row.get('Additional Information') or '').strip(),
        )] += 1
    summaries = []
    for (reason_code, impact_dcr, exemption_reason, additional_information), count in pattern_counts.most_common(3):
        parts = [f'{count}x {titleize_token_text(reason_code) or "Unknown RTS code"}']
        if impact_dcr:
            parts.append(f'Impact DCR {impact_dcr}')
        if additional_information:
            parts.append(additional_information)
        elif exemption_reason:
            parts.append(exemption_reason)
        summaries.append(' / '.join(parts))
    if summaries:
        lines.append(f"RTS pattern summary: {'; '.join(summaries)}.")
    return lines


def evaluate_business_closed_timing(row: dict[str, str], timing_rows: dict[str, dict[str, str]]) -> dict[str, str | bool]:
    tracking_id = (row.get('Tracking ID') or '').strip()
    timing_row = timing_rows.get(tracking_id)
    if not timing_row:
        return {
            'status': 'missing',
            'is_ready': False,
            'summary': 'Timing evidence missing for scheduled delivery time versus Business Closed scan.',
            'scheduled_delivery_time': '',
            'business_closed_time': '',
            'evidence_source': '',
            'notes': '',
        }

    scheduled_text = (timing_row.get('scheduled_delivery_time') or timing_row.get('Scheduled Delivery Time') or '').strip()
    closed_text = (timing_row.get('business_closed_time') or timing_row.get('Business Closed Time') or '').strip()
    evidence_source = (timing_row.get('evidence_source') or timing_row.get('Evidence Source') or '').strip()
    notes = (timing_row.get('notes') or timing_row.get('Notes') or '').strip()
    scheduled_time = parse_clock_time(scheduled_text)
    closed_time = parse_clock_time(closed_text)
    if scheduled_time is None or closed_time is None:
        return {
            'status': 'missing',
            'is_ready': False,
            'summary': notes or 'Timing evidence is incomplete or unparsable; hold until scheduled delivery time and Business Closed timestamp are verified.',
            'scheduled_delivery_time': scheduled_text,
            'business_closed_time': closed_text,
            'evidence_source': evidence_source,
            'notes': notes,
        }

    latest_valid_mark_minutes = minutes_since_midnight(scheduled_time) + BUSINESS_CLOSED_SCHEDULE_GRACE_MINUTES
    closed_minutes = minutes_since_midnight(closed_time)
    if closed_minutes > latest_valid_mark_minutes:
        summary = (
            f'Business Closed was marked at {format_clock_time(closed_time)} after the scheduled delivery time '
            f'of {format_clock_time(scheduled_time)}.'
        )
        return {
            'status': 'invalid',
            'is_ready': False,
            'summary': summary,
            'scheduled_delivery_time': scheduled_text,
            'business_closed_time': closed_text,
            'evidence_source': evidence_source,
            'notes': notes,
        }

    summary = (
        f'Timing evidence passed: Business Closed was marked at {format_clock_time(closed_time)} '
        f'on or before the scheduled delivery time of {format_clock_time(scheduled_time)}.'
    )
    return {
        'status': 'valid',
        'is_ready': True,
        'summary': summary,
        'scheduled_delivery_time': scheduled_text,
        'business_closed_time': closed_text,
        'evidence_source': evidence_source,
        'notes': notes,
    }


def infer_week_parts(week_folder: Path) -> tuple[int, int, str, str]:
    match = re.search(r'(\d{4})-wk(\d{1,2})$', week_folder.name)
    if not match:
        raise ValueError(f'Could not infer week from folder name: {week_folder.name}')
    year = int(match.group(1))
    week_number = int(match.group(2))
    return year, week_number, f'{year}-W{week_number:02d}', f'{week_number:02d}'


def prior_week_folder(week_folder: Path) -> Path | None:
    year, week_number, _, _ = infer_week_parts(week_folder)
    if week_number <= 1:
        return None
    candidate = week_folder.parent / f'{year}-wk{week_number - 1:02d}'
    return candidate if candidate.is_dir() else None


def iso_week_monday(year: int, week_number: int) -> dt.date:
    return dt.date.fromisocalendar(year, week_number, 1)


def amazon_week_date_window(year: int, week_number: int) -> tuple[dt.date, dt.date]:
    monday = iso_week_monday(year, week_number)
    return monday - dt.timedelta(days=1), monday + dt.timedelta(days=5)


def find_one(week_folder: Path, pattern: str) -> Path | None:
    needle = pattern.lower()
    matches = sorted(path for path in list_files(week_folder) if needle in path.name.lower())
    return matches[0] if matches else None


def find_all(week_folder: Path, pattern: str) -> list[Path]:
    needle = pattern.lower()
    return sorted(path for path in list_files(week_folder) if needle in path.name.lower())


def require_file(week_folder: Path, pattern: str) -> Path:
    match = find_one(week_folder, pattern)
    if match is None:
        raise FileNotFoundError(f'Missing required file matching: {pattern}')
    return match


@lru_cache(maxsize=None)
def list_files(week_folder: Path) -> tuple[Path, ...]:
    return tuple(path for path in week_folder.iterdir() if path.is_file())


@lru_cache(maxsize=None)
def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open('r', encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def col_index(ref: str) -> int:
    value = 0
    for char in ref:
        value = value * 26 + (ord(char) - 64)
    return value - 1


def xlsx_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get('t')
    if cell_type == 'inlineStr':
        inline = cell.find('a:is', NS)
        if inline is None:
            return ''
        return ''.join(node.text or '' for node in inline.iterfind('.//a:t', NS))
    value = cell.find('a:v', NS)
    if value is None or value.text is None:
        return ''
    if cell_type == 's':
        idx = int(value.text)
        return shared_strings[idx] if 0 <= idx < len(shared_strings) else ''
    return value.text


@lru_cache(maxsize=None)
def read_xlsx_sheets(path: Path) -> dict[str, list[list[str]]]:
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared_xml = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            for item in shared_xml.findall('a:si', NS):
                shared_strings.append(''.join(node.text or '' for node in item.iterfind('.//a:t', NS)))

        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        rid_to_target = {
            rel.attrib['Id']: rel.attrib['Target'].lstrip('/')
            for rel in relationships
            if rel.attrib.get('Type', '').endswith('/worksheet')
        }

        result: dict[str, list[list[str]]] = {}
        for sheet in workbook.findall('a:sheets/a:sheet', NS):
            rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = rid_to_target[rid]
            sheet_xml = ET.fromstring(archive.read(target))
            rows_out: list[list[str]] = []
            for row in sheet_xml.findall('.//a:sheetData/a:row', NS):
                cells = row.findall('a:c', NS)
                max_col = -1
                values: dict[int, str] = {}
                for cell in cells:
                    ref = cell.attrib.get('r', 'A1')
                    match = re.match(r'([A-Z]+)', ref)
                    if not match:
                        continue
                    idx = col_index(match.group(1))
                    values[idx] = xlsx_cell_value(cell, shared_strings)
                    max_col = max(max_col, idx)
                if max_col < 0:
                    rows_out.append([])
                    continue
                row_values = [''] * (max_col + 1)
                for idx, value in values.items():
                    row_values[idx] = value
                rows_out.append(row_values)
            result[sheet.attrib['name']] = rows_out
        return result


def render_markdown_pdf(md_path: Path, pdf_path: Path) -> None:
    renderer = ROOT / 'scripts' / 'render_markdown_to_pdf.py'
    subprocess.run([sys.executable, str(renderer), str(md_path), str(pdf_path)], check=True, stdout=subprocess.DEVNULL)


def slugify(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def write_csv_dict_rows(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    with path.open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, '') for key in fieldnames})


def extract_pdf_page(source_path: Path, page_index: int, output_path: Path) -> None:
    reader = PdfReader(str(source_path))
    if page_index < 0 or page_index >= len(reader.pages):
        raise IndexError(f'Page index {page_index} out of range for {source_path}')
    writer = PdfWriter()
    writer.add_page(reader.pages[page_index])
    with output_path.open('wb') as handle:
        writer.write(handle)


def find_pdf_page(source_path: Path, patterns: list[str]) -> int | None:
    lowered = [pattern.lower() for pattern in patterns if pattern]
    if not lowered:
        return None
    reader = PdfReader(str(source_path))
    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or '').lower()
        if all(pattern in text for pattern in lowered):
            return index
    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or '').lower()
        if any(pattern in text for pattern in lowered):
            return index
    return None


def render_pdf_page_thumbnail(source_path: Path, page_index: int, output_path: Path) -> bool:
    temp_pdf = output_path.with_suffix('.page.pdf')
    try:
        extract_pdf_page(source_path, page_index, temp_pdf)
        subprocess.run(
            ['qlmanage', '-t', '-s', '1600', '-o', str(output_path.parent), str(temp_pdf)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        generated = output_path.parent / f'{temp_pdf.name}.png'
        if not generated.exists():
            return False
        if output_path.exists():
            output_path.unlink()
        move(str(generated), str(output_path))
        return True
    except (FileNotFoundError, subprocess.CalledProcessError, IndexError):
        return False
    finally:
        if temp_pdf.exists():
            temp_pdf.unlink()


def evidence_file_rel(path: Path, week_folder: Path) -> str:
    return str(path.relative_to(week_folder))


def titleize_token_text(value: str) -> str:
    text = value.strip()
    if not text:
        return ''
    return text.replace('_', ' ').replace('-', ' ').title()


def to_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(',', '')
    if not text:
        return None
    if text.endswith('%'):
        text = text[:-1]
    try:
        return float(text)
    except ValueError:
        return None


def to_int(value: str | None) -> int:
    number = to_float(value)
    if number is None:
        return 0
    return int(round(number))


def safe_pct(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return (numerator / denominator) * 100


def mean(values: list[float]) -> float | None:
    return statistics.mean(values) if values else None


def fmt_num(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return 'n/a'
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer() and digits == 0):
        return f'{int(value):,}'
    return f'{value:,.{digits}f}'


def fmt_pct(value: float | None, digits: int = 2) -> str:
    if value is None:
        return 'n/a'
    return f'{value:.{digits}f}%'


def signed_delta(current: float | int | None, prior: float | int | None, digits: int = 2) -> str:
    if current is None or prior is None:
        return 'n/a'
    delta = current - prior
    if isinstance(delta, float) and not delta.is_integer():
        return f'{delta:+.{digits}f}'
    return f'{int(round(delta)):+,}'


def trend_word(current: float | int | None, prior: float | int | None, higher_is_better: bool = True) -> str:
    if current is None or prior is None:
        return 'n/a'
    if math.isclose(float(current), float(prior), abs_tol=1e-9):
        return 'Flat'
    improved = current > prior if higher_is_better else current < prior
    return 'Up' if improved else 'Down'


def trend_read(current: float | int | None, prior: float | int | None, higher_is_better: bool, positive: str, negative: str, flat: str = 'Stable') -> str:
    if current is None or prior is None:
        return 'No prior baseline'
    if math.isclose(float(current), float(prior), abs_tol=1e-9):
        return flat
    improved = current > prior if higher_is_better else current < prior
    return positive if improved else negative


def build_driver_map(rows: list[dict[str, str]], name_key: str, id_key: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for row in rows:
        transporter_id = row.get(id_key, '').strip()
        if not transporter_id:
            continue
        result[transporter_id] = {'name': row.get(name_key, '').strip(), 'id': transporter_id}
    return result


def extract_capacity_metrics(path: Path | None, start_date: dt.date | None = None, end_date: dt.date | None = None) -> dict[str, object]:
    if path is None:
        return {'available': False, 'daily': [], 'avg_reliability': None, 'all_days_100': False, 'dropped_routes': 0}
    sheets = read_xlsx_sheets(path)
    rows = next(iter(sheets.values()))
    daily = []
    for row in rows:
        if not row or not re.match(r'^\d{4}-\d{2}-\d{2}$', row[0] if row else ''):
            continue
        row_date = dt.date.fromisoformat(row[0])
        if start_date and row_date < start_date:
            continue
        if end_date and row_date > end_date:
            continue
        score = to_float(row[13] if len(row) > 13 else '')
        daily.append({
            'date': row[0],
            'final_scheduled': to_int(row[4] if len(row) > 4 else ''),
            'completed_routes': to_int(row[5] if len(row) > 5 else ''),
            'amazon_paid_cancels': to_int(row[7] if len(row) > 7 else ''),
            'reliability_target': to_int(row[9] if len(row) > 9 else ''),
            'dsp_dropped_routes': to_int(row[11] if len(row) > 11 else ''),
            'capacity_reliability_score': score,
        })
    avg_reliability = mean([item['capacity_reliability_score'] for item in daily if item['capacity_reliability_score'] is not None])
    return {
        'available': True,
        'daily': daily,
        'avg_reliability': avg_reliability,
        'all_days_100': bool(daily) and all(item['capacity_reliability_score'] is not None and math.isclose(item['capacity_reliability_score'], 1.0, abs_tol=1e-9) for item in daily),
        'dropped_routes': sum(item['dsp_dropped_routes'] for item in daily),
    }


def extract_compliance_metrics(path: Path | None) -> dict[str, object]:
    if path is None:
        return {'available': False, 'score': None, 'compliant': None}
    rows = next(iter(read_xlsx_sheets(path).values()))
    for row in rows:
        if not row:
            continue
        if any('Point-in-Time Assessment Score' in cell for cell in row if cell):
            score = next((to_float(cell) for cell in row if to_float(cell) is not None), None)
            compliant = next((cell.strip() for cell in row if cell.strip().upper() in {'YES', 'NO'}), None)
            return {
                'available': True,
                'score': score,
                'compliant': compliant,
            }
    return {'available': True, 'score': None, 'compliant': None}


def extract_dvic_metrics(paths: list[Path]) -> dict[str, object]:
    rows_out: list[dict[str, str]] = []
    for path in paths:
        sheets = read_xlsx_sheets(path)
        rows = next(iter(sheets.values()))
        if not rows:
            continue
        headers = rows[0]
        for values in rows[1:]:
            if not any(values):
                continue
            row = {headers[idx]: values[idx] if idx < len(values) else '' for idx in range(len(headers)) if headers[idx]}
            rows_out.append(row)
    durations = [to_int(row.get('duration')) for row in rows_out if row.get('duration') not in (None, '')]
    return {
        'available': bool(paths),
        'file_count': len(paths),
        'rows': rows_out,
        'inspection_count': len(rows_out),
        'avg_duration_seconds': mean(durations),
        'short_30': sum(1 for value in durations if value <= 30),
        'short_20': sum(1 for value in durations if value <= 20),
        'status_counts': Counter((row.get('inspection_status') or '').strip() for row in rows_out if (row.get('inspection_status') or '').strip()),
        'unique_transporters': len({row.get('transporter_id', '').strip() for row in rows_out if row.get('transporter_id', '').strip()}),
    }


def extract_sentiment_metrics(path: Path | None) -> dict[str, object]:
    if path is None:
        return {
            'available': False,
            'rows': [],
            'overall_favorable': None,
            'overall_response_rate': None,
            'latest_month': None,
            'latest_avg_favorable': None,
            'latest_avg_response_rate': None,
            'summary_label': None,
        }
    rows = read_csv_rows(path)
    overall = next((row for row in rows if row.get('question', '').startswith('Overall, how satisfied')), None)
    latest_month = max(((row.get('month') or '').strip() for row in rows if (row.get('month') or '').strip()), default=None)
    latest_month_rows = [row for row in rows if latest_month and (row.get('month') or '').strip() == latest_month]
    latest_avg_favorable = mean([to_float(row.get('favorable response rate')) for row in latest_month_rows])
    latest_avg_response_rate = mean([to_float(row.get('response rate')) for row in latest_month_rows])
    return {
        'available': True,
        'rows': rows,
        'overall_favorable': overall.get('favorable response rate') if overall else None,
        'overall_response_rate': overall.get('response rate') if overall else None,
        'latest_month': latest_month,
        'latest_avg_favorable': latest_avg_favorable,
        'latest_avg_response_rate': latest_avg_response_rate,
        'summary_label': 'overall satisfaction' if overall else 'latest sentiment pulse average',
    }


def extract_tenure_metrics(week_folder: Path, week_number: int) -> dict[str, object]:
    das_path = find_one(week_folder, 'tenure_workforce_das_Report')
    calc_path = find_one(week_folder, 'tenure_workforce_calculation_Report')

    das_rows = read_csv_rows(das_path) if das_path else []
    calc_rows = read_csv_rows(calc_path) if calc_path else []

    active_rows = [row for row in das_rows if (row.get('delivery status') or '').strip() == 'Actively Delivering']
    tenured_active_rows = [row for row in active_rows if (row.get('tenure status') or '').strip() == 'Tenured']
    non_tenured_rows = [row for row in active_rows if (row.get('tenure status') or '').strip() != 'Tenured']

    calc_row = next(
        (
            row for row in calc_rows
            if to_int(row.get('week')) == week_number
        ),
        None,
    )
    final_share = to_float(calc_row.get('tenured workforce final')) if calc_row else None
    raw_share = to_float(calc_row.get('tenured workforce raw')) if calc_row else None
    tenured_count = to_int(calc_row.get('delivering das-tenured')) if calc_row else len(tenured_active_rows)
    active_count = to_int(calc_row.get('delivering das-total')) if calc_row else len(active_rows)

    return {
        'available': bool(das_rows or calc_rows),
        'das_rows': das_rows,
        'calc_rows': calc_rows,
        'calc_row': calc_row,
        'active_rows': active_rows,
        'non_tenured_rows': non_tenured_rows,
        'tenured_count': tenured_count,
        'active_count': active_count,
        'tenured_share': final_share if final_share is not None else safe_pct(tenured_count, active_count),
        'raw_tenured_share': raw_share if raw_share is not None else safe_pct(len(tenured_active_rows), len(active_rows)),
        'exemptions': (calc_row.get('exemptions') or '').strip() if calc_row else '',
        'tier': (calc_row.get('tenured workforce tier') or '').strip() if calc_row else '',
    }


def driver_lookup(name_by_id: dict[str, str], transporter_id: str, fallback_name: str = '') -> str:
    return name_by_id.get(transporter_id, fallback_name or transporter_id)


def monitor_output_stem(week_folder: Path, lookback: int) -> str:
    year, week_number, _, _ = infer_week_parts(week_folder)
    monday = dt.date.fromisocalendar(year, week_number, 1)
    first_week_date = monday - dt.timedelta(days=(lookback - 1) * 7)
    first_year, first_week_num, _ = first_week_date.isocalendar()
    if first_year == year:
        return f'week{first_week_num:02d}-week{week_number:02d}-monitoring'
    return f'{first_year}wk{first_week_num:02d}-{year}wk{week_number:02d}-monitoring'


def analyze_week(week_folder: Path) -> dict[str, object]:
    year, week_number, week_label, week_num = infer_week_parts(week_folder)
    business_closed_timing_rows, business_closed_timing_path = load_business_closed_timing_evidence(week_folder, week_num)

    overview_rows = read_csv_rows(require_file(week_folder, 'DSP_Overview_Dashboard'))
    dcr_rows = read_csv_rows(require_file(week_folder, 'Quality_DCR'))
    dsb_rows = read_csv_rows(require_file(week_folder, 'Quality_DSB_DNR'))
    pod_rows = read_csv_rows(require_file(week_folder, 'Quality_POD'))
    psb_rows = read_csv_rows(require_file(week_folder, 'Quality_PSB'))
    cdf_rows = read_csv_rows(require_file(week_folder, 'Quality_CDF'))
    rts_rows = read_csv_rows(require_file(week_folder, 'Quality_RTS'))
    negative_cdf_rows = read_csv_rows(require_file(week_folder, 'DSP_Customer_Delivery_Feedback_negative'))
    concession_rows = read_csv_rows(require_file(week_folder, 'DSP_Delivery_Concessions'))
    safety_path = find_one(week_folder, 'Safety_Dashboard')
    safety_rows = read_csv_rows(safety_path) if safety_path else []
    escalation_path = find_one(week_folder, 'Escalations_(Infractions)_Report')
    escalation_rows = read_csv_rows(escalation_path) if escalation_path else []
    sentiment = extract_sentiment_metrics(find_one(week_folder, 'Sentiment_Report'))
    week_start, week_end = amazon_week_date_window(year, week_number)
    capacity = extract_capacity_metrics(find_one(week_folder, 'Capacity-Reliability'), week_start, week_end)
    compliance = extract_compliance_metrics(find_one(week_folder, 'Compliance-Supplementary-Report'))
    # Amazon has changed the DVIC export filename more than once. Match the
    # stable DVIC prefix so both legacy and current daily exports are loaded.
    dvic_paths = find_all(week_folder, 'DVIC_')
    dvic = extract_dvic_metrics(dvic_paths)
    tenure = extract_tenure_metrics(week_folder, week_number)

    name_by_id = {**{row['Transporter ID'].strip(): row['Delivery Associate '].strip() for row in overview_rows if row.get('Transporter ID')},
                  **{row['Transporter ID'].strip(): row['Delivery Associate '].strip() for row in dcr_rows if row.get('Transporter ID')},
                  **{row['Delivery Associate'].strip(): row['Delivery Associate Name'].strip() for row in negative_cdf_rows if row.get('Delivery Associate')}}

    standings = Counter((row.get('Overall Standing') or '').strip() for row in overview_rows if (row.get('Overall Standing') or '').strip())
    overall_scores = [to_float(row.get('Overall Score')) for row in overview_rows]
    packages_delivered = sum(to_int(row.get('Packages Delivered')) for row in overview_rows)
    active_das = len(overview_rows)

    dcr_delivered = sum(to_int(row.get('Packages Delivered')) for row in dcr_rows)
    dcr_dispatched = sum(to_int(row.get('Packages Dispatched')) for row in dcr_rows)
    dcr_rate = safe_pct(dcr_delivered, dcr_dispatched)
    dcr_business_closed = sum(to_int(row.get('RTS Business Closed')) for row in dcr_rows)
    dcr_customer_unavailable = sum(to_int(row.get('RTS Customer Unavailable')) for row in dcr_rows)
    dcr_oodt = sum(to_int(row.get('RTS Out of Drive Time')) for row in dcr_rows)
    dcr_unable_to_access = sum(to_int(row.get('RTS Unable To Access')) for row in dcr_rows)
    dcr_missing_access = sum(to_int(row.get('RTS Missing or Incorrect Access Code')) for row in dcr_rows)

    pod_success = sum(to_int(row.get('POD Success')) for row in pod_rows)
    pod_opportunities = sum(to_int(row.get('POD Opportunities')) for row in pod_rows)
    pod_rate = safe_pct(pod_success, pod_opportunities)
    pickup_successful_stops = sum(to_int(row.get('Successful Stops')) for row in psb_rows)
    pickup_failed_stops = sum(to_int(row.get('Failed Stops')) for row in psb_rows)
    pickup_total_stops = pickup_successful_stops + pickup_failed_stops

    total_dsb = sum(to_int(row.get('DSB Count')) for row in dsb_rows)
    total_negative_feedback = sum(to_int(row.get('Negative Feedback Count')) for row in cdf_rows)
    total_safety_events = len(safety_rows)

    complaint_type_counts = Counter()
    complaints_by_driver: dict[str, Counter[str]] = defaultdict(Counter)
    complaint_rows_by_driver: dict[str, list[dict[str, str]]] = defaultdict(list)
    complaint_columns = [
        'DA Mishandled Package',
        'DA was Unprofessional',
        'DA did not follow my delivery instructions',
        'Delivered to Wrong Address',
        'Never Received Delivery',
        'Received Wrong Item',
    ]
    for row in negative_cdf_rows:
        transporter_id = (row.get('Delivery Associate') or '').strip()
        driver_name = (row.get('Delivery Associate Name') or transporter_id).strip()
        complaint_rows_by_driver[transporter_id].append(row)
        for column in complaint_columns:
            if to_int(row.get(column)) > 0:
                complaint_type_counts[column] += 1
                complaints_by_driver[transporter_id][column] += 1
        if row.get('Feedback Details'):
            complaints_by_driver[transporter_id][row['Feedback Details']] += 1
        name_by_id[transporter_id] = driver_name

    dsb_impacts = [row for row in concession_rows if to_int(row.get('Impacts DSB')) > 0]
    dsb_by_driver = Counter((row.get('Delivery Associate') or '').strip() for row in dsb_impacts)

    safety_by_driver = Counter((row.get('Transporter ID') or '').strip() for row in safety_rows)
    safety_impact_counts = Counter((row.get('Program Impact') or 'None').strip() for row in safety_rows)

    non_tenured_ids = {(row.get('transporter id') or '').strip() for row in tenure['non_tenured_rows']}

    low_score_rows = sorted(
        overview_rows,
        key=lambda row: (to_float(row.get('Overall Score')) is None, to_float(row.get('Overall Score')) or 9999, row.get('Delivery Associate ', '')),
    )[:6]

    dcr_by_id = {row.get('Transporter ID', '').strip(): row for row in dcr_rows if row.get('Transporter ID')}
    overview_by_id = {row.get('Transporter ID', '').strip(): row for row in overview_rows if row.get('Transporter ID')}
    psb_by_id = {row.get('Transporter ID', '').strip(): row for row in psb_rows if row.get('Transporter ID')}

    dcr_risk_rows = sorted(
        dcr_rows,
        key=lambda row: (
            -(to_int(row.get('Packages Returned to Station - DA Controllable'))),
            to_float(row.get('DCR')) or 999,
            -to_int(row.get('RTS Out of Drive Time')),
        ),
    )[:6]

    complaint_driver_rank = sorted(
        complaint_rows_by_driver.items(),
        key=lambda item: (-len(item[1]), driver_lookup(name_by_id, item[0], item[0])),
    )

    pickup_failed_rows = [row for row in psb_rows if to_int(row.get('Failed Stops')) > 0]
    pickup_driver_rank = sorted(
        [
            (
                driver_lookup(name_by_id, (row.get('Transporter ID') or '').strip(), (row.get('Delivery Associate ') or '').strip()),
                (row.get('Transporter ID') or '').strip(),
                to_int(row.get('Failed Stops')),
                to_int(row.get('Successful Stops')),
                row,
            )
            for row in pickup_failed_rows
            if (row.get('Transporter ID') or '').strip()
        ],
        key=lambda item: (-item[2], item[0]),
    )

    safety_driver_rank = sorted(
        [(driver_lookup(name_by_id, transporter_id, transporter_id), transporter_id, count) for transporter_id, count in safety_by_driver.items() if transporter_id],
        key=lambda item: (-item[2], item[0]),
    )

    dsb_driver_rank = sorted(
        [(driver_lookup(name_by_id, transporter_id, transporter_id), transporter_id, count) for transporter_id, count in dsb_by_driver.items() if transporter_id],
        key=lambda item: (-item[2], item[0]),
    )

    impact_rts_rows = [row for row in rts_rows if (row.get('Impact DCR') or '').strip().upper() == 'Y']
    impact_code_counts = Counter((row.get('DA Selected RTS Code') or '').strip().upper() for row in impact_rts_rows)
    impact_info_counts = Counter((row.get('Additional Information') or '').strip().upper() for row in impact_rts_rows if (row.get('Additional Information') or '').strip())

    business_closed_y = defaultdict(list)
    business_closed_ready = defaultdict(list)
    business_closed_hold = defaultdict(list)
    business_closed_detail = defaultdict(list)
    business_closed_timing_by_tba: dict[str, dict[str, str | bool]] = {}
    business_closed_hold_notes = defaultdict(list)
    impact_codes_by_driver = defaultdict(Counter)
    impact_info_by_driver = defaultdict(Counter)
    oodt_by_driver = Counter()
    no_code_by_driver = Counter()
    object_missing_by_driver = Counter()
    for row in rts_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        code = (row.get('DA Selected RTS Code') or '').strip().upper()
        info = (row.get('Additional Information') or '').strip().upper()
        impact = (row.get('Impact DCR') or '').strip().upper()
        exemption = (row.get('Exemption Reason') or '').strip()
        if code == 'BUSINESS CLOSED':
            business_closed_detail[transporter_id].append(row)
            if impact == 'Y' and exemption == 'No Exemption Applied':
                business_closed_y[transporter_id].append(row)
                timing_assessment = evaluate_business_closed_timing(row, business_closed_timing_rows)
                tracking_id = (row.get('Tracking ID') or '').strip()
                if tracking_id:
                    business_closed_timing_by_tba[tracking_id] = timing_assessment
                if timing_assessment['is_ready']:
                    business_closed_ready[transporter_id].append(row)
                else:
                    business_closed_hold[transporter_id].append(row)
                    business_closed_hold_notes[transporter_id].append(str(timing_assessment['summary']))
        if impact == 'Y':
            impact_codes_by_driver[transporter_id][code] += 1
            if info:
                impact_info_by_driver[transporter_id][info] += 1
            if code == 'OUT OF DRIVING TIME':
                oodt_by_driver[transporter_id] += 1
            if code == 'NO RTS CODE SELECTED':
                no_code_by_driver[transporter_id] += 1
            if info == 'OBJECT MISSING':
                object_missing_by_driver[transporter_id] += 1

    dispute_candidates: list[dict[str, object]] = []
    for transporter_id, rows in business_closed_ready.items():
        dcr_row = dcr_by_id.get(transporter_id, {})
        mixed_impact = sum(count for code, count in impact_codes_by_driver[transporter_id].items() if code != 'BUSINESS CLOSED')
        held_rows = business_closed_hold.get(transporter_id, [])
        dispute_candidates.append({
            'type': 'file',
            'metric': 'DCR',
            'transporter_id': transporter_id,
            'name': driver_lookup(name_by_id, transporter_id, transporter_id),
            'count': len(rows),
            'tbas': [row.get('Tracking ID', '') for row in rows if row.get('Tracking ID')],
            'dcr': dcr_row.get('DCR', ''),
            'business_closed_summary': to_int(dcr_row.get('RTS Business Closed')),
            'controllable_summary': to_int(dcr_row.get('Packages Returned to Station - DA Controllable')),
            'mixed_impact': mixed_impact,
            'confidence': max(5.5, min(8.5, 6.0 + 0.6 * len(rows) - 0.15 * mixed_impact)),
            'rts_codes': dict(impact_codes_by_driver[transporter_id]),
            'timing_ready_count': len(rows),
            'timing_hold_count': len(held_rows),
            'validation_reason': '',
        })

    for row in dcr_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        business_closed_summary = to_int(row.get('RTS Business Closed'))
        if business_closed_summary <= 0 or transporter_id in business_closed_ready:
            continue
        detail_rows = business_closed_detail.get(transporter_id, [])
        if not detail_rows:
            continue
        impact_y_count = sum(1 for detail in detail_rows if (detail.get('Impact DCR') or '').strip().upper() == 'Y')
        held_rows = business_closed_hold.get(transporter_id, [])
        held_statuses = {
            str(business_closed_timing_by_tba.get((detail.get('Tracking ID') or '').strip(), {}).get('status', ''))
            for detail in held_rows
            if (detail.get('Tracking ID') or '').strip()
        }
        if held_rows and held_statuses and held_statuses.issubset({'invalid'}):
            continue
        validation_reason = 'The score summary shows business-closed volume, but the RTS detail needs attribution reconciliation before a clean filing exists.'
        if held_rows:
            unique_notes = []
            for note in business_closed_hold_notes.get(transporter_id, []):
                if note not in unique_notes:
                    unique_notes.append(note)
            validation_reason = ' '.join(unique_notes) if unique_notes else validation_reason
        dispute_candidates.append({
            'type': 'validate',
            'metric': 'DCR',
            'transporter_id': transporter_id,
            'name': driver_lookup(name_by_id, transporter_id, row.get('Delivery Associate ', transporter_id)),
            'count': business_closed_summary,
            'tbas': [detail.get('Tracking ID', '') for detail in detail_rows if detail.get('Tracking ID')][:5],
            'dcr': row.get('DCR', ''),
            'business_closed_summary': business_closed_summary,
            'controllable_summary': to_int(row.get('Packages Returned to Station - DA Controllable')),
            'impact_y_count': impact_y_count,
            'confidence': max(2.5, min(4.5, 3.0 + 0.15 * business_closed_summary - 0.4 * impact_y_count)),
            'rts_codes': dict(impact_codes_by_driver[transporter_id]),
            'timing_ready_count': 0,
            'timing_hold_count': len(held_rows),
            'validation_reason': validation_reason,
        })

    pickup_dispute_candidates: list[dict[str, object]] = []
    for name, transporter_id, failed_stops, successful_stops, row in pickup_driver_rank:
        overview_row = overview_by_id.get(transporter_id, {})
        psb_score = row.get('PSB', '') or overview_row.get('PSB', '')
        pickup_dispute_candidates.append({
            'type': 'validate',
            'metric': 'PSB',
            'transporter_id': transporter_id,
            'name': name,
            'count': failed_stops,
            'tbas': [],
            'dcr': '',
            'confidence': max(2.5, min(5.0, 2.8 + 0.55 * failed_stops)),
            'failed_stops': failed_stops,
            'successful_stops': successful_stops,
            'pickup_stops': failed_stops + successful_stops,
            'psb': psb_score,
            'validation_reason': 'Pickup issue surfaced in PSB summary rows, but the local export does not include stop IDs, reason proof, or geo/network evidence yet.',
        })

    dispute_candidates.extend(pickup_dispute_candidates)

    dispute_candidates.sort(key=lambda item: (
        0 if item['type'] == 'file' else 1,
        0 if item.get('metric') == 'DCR' else 1,
        -float(item['confidence']),
        -int(item['count']),
        str(item['name']).lower(),
    ))

    coaching_cluster_names = []
    for transporter_id, rows in complaint_driver_rank[:6]:
        name = driver_lookup(name_by_id, transporter_id, transporter_id)
        if name not in coaching_cluster_names:
            coaching_cluster_names.append(name)
    for name, transporter_id, count in dsb_driver_rank[:3]:
        if name not in coaching_cluster_names:
            coaching_cluster_names.append(name)

    escalations_unacked = sum(1 for row in escalation_rows if (row.get('dsp_appealed_or_da_coaching_retraining_ack') or '').strip().lower() == 'no')

    return {
        'week_folder': week_folder,
        'year': year,
        'week_number': week_number,
        'week_label': week_label,
        'week_num': week_num,
        'overview': {
            'active_das': active_das,
            'avg_score': mean([value for value in overall_scores if value is not None]),
            'packages_delivered': packages_delivered,
            'standings': standings,
            'low_scores': low_score_rows,
            'all_platinum': active_das > 0 and standings.get('Platinum', 0) == active_das,
        },
        'dcr': {
            'rate': dcr_rate,
            'delivered': dcr_delivered,
            'dispatched': dcr_dispatched,
            'business_closed': dcr_business_closed,
            'customer_unavailable': dcr_customer_unavailable,
            'oodt': dcr_oodt,
            'unable_to_access': dcr_unable_to_access,
            'missing_access': dcr_missing_access,
            'risk_rows': dcr_risk_rows,
        },
        'pod': {'rate': pod_rate, 'success': pod_success, 'opportunities': pod_opportunities},
        'psb': {
            'score_rows': psb_rows,
            'successful_stops': pickup_successful_stops,
            'failed_stops': pickup_failed_stops,
            'total_stops': pickup_total_stops,
            'driver_rank': pickup_driver_rank,
        },
        'dsb': {'total': total_dsb, 'impact_rows': dsb_impacts, 'driver_rank': dsb_driver_rank},
        'cdf': {
            'total_negative_feedback': total_negative_feedback,
            'complaint_type_counts': complaint_type_counts,
            'driver_rank': complaint_driver_rank,
            'complaint_rows_by_driver': complaint_rows_by_driver,
        },
        'safety': {
            'available': safety_path is not None,
            'total_events': total_safety_events,
            'impact_counts': safety_impact_counts,
            'driver_rank': safety_driver_rank,
            'approved_disputes': sum(1 for row in safety_rows if 'APPROVED' in (row.get('Review Details') or '').upper()),
        },
        'capacity': capacity,
        'compliance': compliance,
        'dvic': dvic,
        'tenure': {
            **tenure,
            'non_tenured_count': len(tenure['non_tenured_rows']),
            'risk_non_tenured_names': [
                driver_lookup(name_by_id, transporter_id, transporter_id)
                for transporter_id in sorted(non_tenured_ids)
                if transporter_id in {row.get('Transporter ID', '').strip() for row in dcr_risk_rows}
                or transporter_id in {item[0] for item in complaint_driver_rank[:8]}
            ],
        },
        'sentiment': sentiment,
        'escalations': {
            'available': escalation_path is not None,
            'count': len(escalation_rows),
            'unacked_count': escalations_unacked,
        },
        'rts': {
            'impact_code_counts': impact_code_counts,
            'impact_info_counts': impact_info_counts,
            'oodt_by_driver': oodt_by_driver,
            'no_code_by_driver': no_code_by_driver,
            'object_missing_by_driver': object_missing_by_driver,
            'business_closed_hold_notes': {key: list(value) for key, value in business_closed_hold_notes.items()},
        },
        'disputes': dispute_candidates,
        'pickup_disputes': pickup_dispute_candidates,
        'dispute_inputs': {
            'business_closed_y': dict(business_closed_y),
            'business_closed_ready': dict(business_closed_ready),
            'business_closed_hold': dict(business_closed_hold),
            'business_closed_detail': dict(business_closed_detail),
            'business_closed_timing_by_tba': business_closed_timing_by_tba,
            'business_closed_timing_source': business_closed_timing_path,
            'psb_by_id': psb_by_id,
        },
        'name_by_id': name_by_id,
        'coaching_cluster_names': coaching_cluster_names,
        'files': {
            'overview': 'DSP_Overview_Dashboard',
            'safety': safety_path.name if safety_path else None,
        },
        'folder_name': week_folder.name,
    }


def metric_or_na(data: dict[str, object], *keys: str) -> object | None:
    current: object = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current


def summarize_low_score_row(row: dict[str, str]) -> str:
    name = row.get('Delivery Associate ', '').strip()
    score = row.get('Overall Score', 'n/a')
    dcr = row.get('DCR', 'n/a')
    cdf = row.get('CDF DPMO', 'n/a')
    return f'{name} ({score} overall, DCR {dcr}, CDF DPMO {cdf})'


def build_snapshot_rows(current: dict[str, object], prior: dict[str, object] | None) -> list[tuple[str, str, str, str, str]]:
    prior_overview = prior.get('overview', {}) if prior else {}
    prior_dcr = prior.get('dcr', {}) if prior else {}
    prior_pod = prior.get('pod', {}) if prior else {}
    prior_psb = prior.get('psb', {}) if prior else {}
    prior_cdf = prior.get('cdf', {}) if prior else {}
    prior_dsb = prior.get('dsb', {}) if prior else {}
    prior_safety = prior.get('safety', {}) if prior else {}
    prior_capacity = prior.get('capacity', {}) if prior else {}
    prior_compliance = prior.get('compliance', {}) if prior else {}
    prior_tenure = prior.get('tenure', {}) if prior else {}

    def prior_value(value: object, formatter) -> str:
        return formatter(value) if value is not None else 'n/a'

    capacity_current = (
        'Unavailable'
        if not current['capacity']['available']
        else ('100% daily' if current['capacity']['all_days_100'] else fmt_pct(current['capacity']['avg_reliability'] * 100, 2))
    )
    capacity_prior = (
        'n/a'
        if not prior or not prior_capacity.get('available')
        else ('100% daily' if prior_capacity.get('all_days_100') else fmt_pct(prior_capacity.get('avg_reliability') * 100, 2))
    )
    compliance_current = (
        'Unavailable'
        if not current['compliance']['available']
        else f"{fmt_num(current['compliance']['score'], 1)}% / {current['compliance']['compliant'] or 'n/a'}"
    )
    tenure_current = (
        'Unavailable'
        if not current['tenure']['available']
        else f"{fmt_pct(current['tenure']['tenured_share'] * 100, 2)} ({current['tenure']['tenured_count']}/{current['tenure']['active_count']})"
    )

    rows = [
        ('Active DAs', str(current['overview']['active_das']), str(prior_overview.get('active_das', 'n/a')) if prior else 'n/a', trend_word(current['overview']['active_das'], prior_overview.get('active_das') if prior else None, True), trend_read(current['overview']['active_das'], prior_overview.get('active_das') if prior else None, True, 'Broader staffing coverage', 'Coverage tighter', 'Stable staffing coverage')),
        ('Avg overall score', fmt_num(current['overview']['avg_score'], 2), prior_value(prior_overview.get('avg_score') if prior else None, lambda x: fmt_num(x, 2)), trend_word(current['overview']['avg_score'], prior_overview.get('avg_score') if prior else None, True), trend_read(current['overview']['avg_score'], prior_overview.get('avg_score') if prior else None, True, 'Driver-level execution improved', 'Driver execution softer')),
        ('Packages delivered', fmt_num(current['overview']['packages_delivered'], 0), prior_value(prior_overview.get('packages_delivered') if prior else None, lambda x: fmt_num(x, 0)), trend_word(current['overview']['packages_delivered'], prior_overview.get('packages_delivered') if prior else None, True), trend_read(current['overview']['packages_delivered'], prior_overview.get('packages_delivered') if prior else None, True, 'Volume handled well', 'Lower delivered volume', 'Volume stable')),
        ('DCR', fmt_pct(current['dcr']['rate'], 2), prior_value(prior_dcr.get('rate') if prior else None, lambda x: fmt_pct(x, 2)), trend_word(current['dcr']['rate'], prior_dcr.get('rate') if prior else None, True), trend_read(current['dcr']['rate'], prior_dcr.get('rate') if prior else None, True, 'Strong controllable completion', 'More completion leakage')),
        ('POD', fmt_pct(current['pod']['rate'], 2), prior_value(prior_pod.get('rate') if prior else None, lambda x: fmt_pct(x, 2)), trend_word(current['pod']['rate'], prior_pod.get('rate') if prior else None, True), trend_read(current['pod']['rate'], prior_pod.get('rate') if prior else None, True, 'Better delivery confirmation quality', 'Photo/POD execution slipped')),
        ('Failed pickup stops', fmt_num(current['psb']['failed_stops'], 0), prior_value(prior_psb.get('failed_stops') if prior else None, lambda x: fmt_num(x, 0)), trend_word(current['psb']['failed_stops'], prior_psb.get('failed_stops') if prior else None, False), trend_read(current['psb']['failed_stops'], prior_psb.get('failed_stops') if prior else None, False, 'Pickup execution improved', 'Pickup leakage increased', 'Pickup leakage stable')),
        ('DSB defects', fmt_num(current['dsb']['total'], 0), prior_value(prior_dsb.get('total') if prior else None, lambda x: fmt_num(x, 0)), trend_word(current['dsb']['total'], prior_dsb.get('total') if prior else None, False), trend_read(current['dsb']['total'], prior_dsb.get('total') if prior else None, False, 'Less scan-quality leakage', 'More scan-quality leakage', 'Small scan-quality leak')),
        ('CDF negative feedback', fmt_num(current['cdf']['total_negative_feedback'], 0), prior_value(prior_cdf.get('total_negative_feedback') if prior else None, lambda x: fmt_num(x, 0)), trend_word(current['cdf']['total_negative_feedback'], prior_cdf.get('total_negative_feedback') if prior else None, False), trend_read(current['cdf']['total_negative_feedback'], prior_cdf.get('total_negative_feedback') if prior else None, False, 'Customer experience improved', 'Main customer-experience weakness')),
        ('Safety events', fmt_num(current['safety']['total_events'], 0) if current['safety']['available'] else 'Unavailable', prior_value(prior_safety.get('total_events') if prior and prior_safety.get('available') else None, lambda x: fmt_num(x, 0)) if prior else 'n/a', trend_word(current['safety']['total_events'] if current['safety']['available'] else None, prior_safety.get('total_events') if prior and prior_safety.get('available') else None, False), trend_read(current['safety']['total_events'] if current['safety']['available'] else None, prior_safety.get('total_events') if prior and prior_safety.get('available') else None, False, 'Safety event count improved', 'Safety pressure increased', 'Safety level stable')),
        ('Capacity reliability', capacity_current, capacity_prior, trend_word(current['capacity']['avg_reliability'] if current['capacity']['available'] else None, prior_capacity.get('avg_reliability') if prior_capacity.get('available') else None, True), 'Report not posted' if not current['capacity']['available'] else ('Zero DSP dropped routes' if current['capacity']['dropped_routes'] == 0 else f"{current['capacity']['dropped_routes']} DSP dropped routes")),
        ('CAS compliance', compliance_current, f"{fmt_num(prior_compliance.get('score'), 1)}% / {prior_compliance.get('compliant') or 'n/a'}" if prior_compliance.get('available') else 'n/a', trend_word(current['compliance']['score'] if current['compliance']['available'] else None, prior_compliance.get('score') if prior_compliance.get('available') else None, True), 'Report not posted' if not current['compliance']['available'] else ('Compliant' if str(current['compliance']['compliant']).upper() == 'YES' else 'Needs compliance review')),
        ('Tenured workforce', tenure_current, f"{fmt_pct(prior_tenure.get('tenured_share') * 100, 2)} ({prior_tenure.get('tenured_count')}/{prior_tenure.get('active_count')})" if prior_tenure.get('available') else 'n/a', trend_word(current['tenure']['tenured_share'] if current['tenure']['available'] else None, prior_tenure.get('tenured_share') if prior_tenure.get('available') else None, True), 'Report not posted' if not current['tenure']['available'] else trend_read(current['tenure']['tenured_share'], prior_tenure.get('tenured_share') if prior_tenure.get('available') else None, True, 'More experienced active roster', 'Ramp quality needs more attention', 'Tenure mix stable')),
    ]
    return rows


def build_summary_markdown(current: dict[str, object], prior: dict[str, object] | None) -> str:
    prepared = dt.date.today().isoformat()
    week_num = current['week_num']
    prior_label = prior['week_label'] if prior else 'prior week'

    volume_delta = signed_delta(current['overview']['packages_delivered'], prior['overview']['packages_delivered'] if prior else None, 0)
    dcr_delta = signed_delta(current['dcr']['rate'], prior['dcr']['rate'] if prior else None, 2)
    pod_delta = signed_delta(current['pod']['rate'], prior['pod']['rate'] if prior else None, 2)
    cdf_delta = signed_delta(current['cdf']['total_negative_feedback'], prior['cdf']['total_negative_feedback'] if prior else None, 0)
    safety_delta = signed_delta(current['safety']['total_events'], prior['safety']['total_events'] if prior and prior['safety']['available'] else None, 0)
    dsb_delta = signed_delta(current['dsb']['total'], prior['dsb']['total'] if prior else None, 0)

    top_complaint_lines = []
    for transporter_id, rows in current['cdf']['driver_rank'][:5]:
        name = current['name_by_id'].get(transporter_id, transporter_id)
        details = current['cdf']['complaint_rows_by_driver'][transporter_id]
        issue_counter = Counter(row.get('Feedback Details', '').strip() for row in details if row.get('Feedback Details'))
        issue_text = ', '.join(f'{label} ({count})' for label, count in issue_counter.most_common(2)) if issue_counter else 'mixed complaints'
        top_complaint_lines.append(f'{name} - {len(rows)} complaints, {issue_text}')

    low_score_names = '\n'.join(f'- {summarize_low_score_row(row)}' for row in current['overview']['low_scores'])

    dcr_risk_lines = []
    for row in current['dcr']['risk_rows'][:4]:
        name = row.get('Delivery Associate ', '').strip()
        controllable = to_int(row.get('Packages Returned to Station - DA Controllable'))
        dcr = row.get('DCR', 'n/a')
        components = []
        for label, value in [
            ('out-of-driving-time', to_int(row.get('RTS Out of Drive Time'))),
            ('business-closed', to_int(row.get('RTS Business Closed'))),
            ('no-secure-location', to_int(row.get('RTS No Secure Location'))),
        ]:
            if value:
                components.append(f'{value} {label}')
        component_text = f" ({', '.join(components)})" if components else ''
        dcr_risk_lines.append(f'- **{name}**: DCR {dcr}, {controllable} DA-controllable RTS{component_text}')

    complaint_type_lines = '\n'.join(
        f'- **{label}: {count}**' for label, count in current['cdf']['complaint_type_counts'].most_common(3)
    ) or '- No negative feedback rows found.'

    safety_lines = []
    if current['safety']['available']:
        safety_lines.append(f"- Safety dashboard shows **{current['safety']['total_events']}** events" + (f"; prior week change: **{safety_delta}**." if prior and safety_delta != 'n/a' else '.'))
        if current['safety']['impact_counts']:
            impact_summary = ', '.join(f"{label or 'None'}: {count}" for label, count in current['safety']['impact_counts'].most_common())
            safety_lines.append(f'- Program impact mix: **{impact_summary}**.')
        if current['safety']['driver_rank']:
            top_driver = current['safety']['driver_rank'][0]
            safety_lines.append(f'- Highest individual safety exposure: **{top_driver[0]}** with **{top_driver[2]}** events.')
        if current['safety']['approved_disputes']:
            safety_lines.append(f'- **{current["safety"]["approved_disputes"]}** safety events already show dispute approved status.')
    else:
        safety_lines.append('- Safety dashboard file was not available, so safety trend validation is incomplete.')

    week_start, _ = amazon_week_date_window(current['year'], current['week_number'])
    dsb_lines = []
    if current['dsb']['driver_rank']:
        dsb_summary = ', '.join(f'{name} ({count})' for name, _, count in current['dsb']['driver_rank'][:6])
        dsb_lines.append(f'- DSB-impacting concession drivers: **{dsb_summary}**.')
    aged_concessions = 0
    for row in current['dsb']['impact_rows']:
        delivery_date = (row.get('Delivery Date') or '').strip()[:10]
        if delivery_date:
            try:
                if dt.date.fromisoformat(delivery_date) < week_start:
                    aged_concessions += 1
            except ValueError:
                pass
    if aged_concessions:
        dsb_lines.append(f'- **{aged_concessions}** DSB concessions posted from earlier delivery dates; validate before coaching as current-week execution misses.')
    dsb_block = '\n'.join(dsb_lines) if dsb_lines else '- No DSB-impacting concession rows were present.'

    dvic_lines = []
    if current['dvic']['available']:
        dvic_lines.append(f'- DVIC files captured **{current["dvic"]["inspection_count"]}** inspections across **{current["dvic"]["file_count"]}** files.')
        dvic_lines.append(f'- Average DVIC duration was **{fmt_num(current["dvic"]["avg_duration_seconds"], 1)} seconds**.')
        dvic_lines.append(f'- **{current["dvic"]["short_30"]}** inspections were **30 seconds or less**; **{current["dvic"]["short_20"]}** were **20 seconds or less**.')
        if current['dvic']['status_counts']:
            status_summary = ', '.join(f'{label}: {count}' for label, count in current['dvic']['status_counts'].most_common())
            dvic_lines.append(f'- Inspection status mix: **{status_summary}**.')
    else:
        dvic_lines.append('- DVIC files were not present, so maintenance-process timing could not be validated.')
    dvic_block = '\n'.join(dvic_lines)

    tenure_line = (
        '- Tenure/workforce reports were not posted for this week, so hiring and retention metrics are unavailable.'
        if not current['tenure']['available']
        else
        f'- Active roster was **{current["tenure"]["tenured_count"]} tenured / {current["tenure"]["active_count"]} active** '
        f'with scorecard-adjusted tenure at **{fmt_pct((current["tenure"]["tenured_share"] or 0) * 100, 2)}**'
    )
    if current['tenure']['available'] and current['tenure'].get('raw_tenured_share') is not None and current['tenure']['raw_tenured_share'] != current['tenure']['tenured_share']:
        tenure_line += f' (raw active-roster share **{fmt_pct((current["tenure"]["raw_tenured_share"] or 0) * 100, 2)}**).'
    elif current['tenure']['available']:
        tenure_line += '.'
    if current['tenure'].get('tier'):
        tenure_line += f" Tier: **{current['tenure']['tier']}**."
    if current['tenure']['risk_non_tenured_names']:
        tenure_line += f" Higher-risk non-tenured names in the week: **{', '.join(current['tenure']['risk_non_tenured_names'][:5])}**."

    sentiment_label = current['sentiment'].get('summary_label') or 'overall sentiment'
    sentiment_favorable = current['sentiment'].get('overall_favorable')
    sentiment_response_rate = current['sentiment'].get('overall_response_rate')
    if sentiment_favorable is None:
        sentiment_favorable = fmt_pct(current['sentiment'].get('latest_avg_favorable'), 1)
        sentiment_response_rate = fmt_pct(current['sentiment'].get('latest_avg_response_rate'), 1)

    snapshot_table = '\n'.join(
        f'| {metric} | {current_value} | {prior_value} | {trend} | {read} |'
        for metric, current_value, prior_value, trend, read in build_snapshot_rows(current, prior)
    )

    unavailable_supplementary = []
    if not current['capacity']['available']:
        unavailable_supplementary.append('capacity')
    if not current['compliance']['available']:
        unavailable_supplementary.append('compliance')
    if not current['tenure']['available']:
        unavailable_supplementary.append('tenure')
    unavailable_note = (
        f". {', '.join(unavailable_supplementary).capitalize()} {'file was' if len(unavailable_supplementary) == 1 else 'files were'} not yet posted; available execution data points to cleanup areas in customer feedback and concentrated DCR process misses"
        if unavailable_supplementary
        else '. Reliability and compliance stayed controlled, but the cleanup areas were customer feedback and concentrated DCR process misses'
    )

    executive = (
        f"Week {week_num} handled **{fmt_num(current['overview']['packages_delivered'], 0)}** delivered packages"
        + (f" ({volume_delta} vs {prior_label})" if prior else '')
        + f" while DCR landed at **{fmt_pct(current['dcr']['rate'], 2)}**"
        + (f" ({dcr_delta})" if prior else '')
        + f" and POD at **{fmt_pct(current['pod']['rate'], 2)}**"
        + (f" ({pod_delta})" if prior else '')
        + unavailable_note
        + (', pickup leakage' if current['psb']['failed_stops'] else '')
        + (', safety exposure' if current['safety']['available'] and current['safety']['total_events'] else '')
        + ', and DVIC discipline.'
    )

    customer_delta_text = f' (**{cdf_delta}** vs {prior_label})' if prior else ''
    dsb_delta_text = f' ({dsb_delta} vs {prior_label})' if prior else ''
    safety_block = '\n'.join(safety_lines)
    top_complaint_block = '\n'.join(f'{idx + 1}. **{line}**' for idx, line in enumerate(top_complaint_lines)) or '1. **No concentrated complaint lane identified**'
    pickup_top_names = [
        f"{name} ({failed} failed / {failed + successful} pickup stops)"
        for name, _transporter_id, failed, successful, _row in current['psb']['driver_rank'][:4]
    ]
    pickup_line = (
        f"Pickup execution posted **{current['psb']['failed_stops']}** failed stops across "
        f"**{len(current['psb']['driver_rank'])}** driver(s) on **{current['psb']['total_stops']}** pickup stops."
    )
    if pickup_top_names:
        pickup_line += f" Highest pickup-review names: **{', '.join(pickup_top_names)}**."
    bottom_descriptor = 'high-volume, controlled' if prior and current['overview']['packages_delivered'] >= prior['overview']['packages_delivered'] else 'controlled'
    bottom_risks = 'customer experience, concentrated RTS process misses'
    if current['psb']['failed_stops']:
        bottom_risks += ', pickup leakage'
    if current['safety']['available'] and current['safety']['total_events']:
        bottom_risks += ', safety exposure'
    bottom_risks += ', and DVIC consistency'

    capacity_line = (
        '- Capacity Reliability was not posted for this week; do not interpret missing data as 0% reliability or zero dropped routes.'
        if not current['capacity']['available']
        else f"- Capacity reliability was **{'100% every day' if current['capacity']['all_days_100'] else fmt_pct(current['capacity']['avg_reliability'] * 100, 2)}** with **{current['capacity']['dropped_routes']} DSP dropped routes**."
    )
    compliance_line = (
        '- Compliance Supplementary was not posted for this week, so CAS compliance is unavailable.'
        if not current['compliance']['available']
        else f"- CAS compliance posted **{fmt_num(current['compliance']['score'], 1)}%** and **{current['compliance']['compliant'] or 'n/a'}**."
    )
    if unavailable_supplementary:
        bottom_status = f"available execution metrics were controlled; {', '.join(unavailable_supplementary)} {'remains' if len(unavailable_supplementary) == 1 else 'remain'} pending"
    else:
        bottom_status = 'reliability and compliance intact'

    return f"# Week {week_num} Summary\n\n**DSP:** JECS  \n**Station:** DFH7  \n**Week:** {current['week_label']}  \n**Prepared:** {prepared}\n\n## Executive Summary\n{executive}\n\n## DSP Performance Snapshot\n| Metric | Week {week_num} | {prior_label if prior else 'Prior Week'} | Trend | Read |\n|---|---:|---:|---|---|\n{snapshot_table}\n\n## Operational Read\n### 1) Fleet management and route efficiency\n{capacity_line}\n{compliance_line}\n- Delivered volume moved **{volume_delta if prior else fmt_num(current['overview']['packages_delivered'], 0)}**{' vs ' + prior_label if prior else ''} while DCR held at **{fmt_pct(current['dcr']['rate'], 2)}** and POD at **{fmt_pct(current['pod']['rate'], 2)}**.\n- {pickup_line}\n\n### 2) Driver performance\n- Standings mix: **{', '.join(f'{tier}: {count}' for tier, count in current['overview']['standings'].most_common())}**.\n- Lowest-score drivers this week were:\n{low_score_names}\n- Most concentrated DCR process-risk lanes were:\n{chr(10).join(dcr_risk_lines)}\n\n### 3) Customer experience\n- Total negative feedback count was **{current['cdf']['total_negative_feedback']}**{customer_delta_text}.\n- Largest complaint buckets were:\n{complaint_type_lines}\n- Highest-value coaching / review names:\n{top_complaint_block}\n\n### 4) Safety, cost, and quality leakage\n{safety_block}\n- DSB defects totaled **{current['dsb']['total']}**{dsb_delta_text}.\n{dsb_block}\n- Open escalation / infraction rows in the report: **{current['escalations']['count']}**, with **{current['escalations']['unacked_count']}** still not acknowledged.\n\n### 5) Maintenance tracking\n{dvic_block}\n\n### 6) Hiring and retention\n{tenure_line}\n- Driver sentiment {sentiment_label} favorable response rate was **{sentiment_favorable or 'n/a'}** on **{sentiment_response_rate or 'n/a'}** response rate.\n\n## Priority Actions\n### Priority 1 - File the cleanest disputes, coach the rest\n- File business-closed DCR disputes only where the RTS detail clearly shows **Impact DCR = Y**, **No Exemption Applied**, and timing evidence that does **not** place the Business Closed mark after the scheduled delivery time.\n- Move failed-pickup cases into dispute prep only after you gather the stop IDs plus geo / dispatch / network proof needed to support a PSB reason.\n- Treat OODT, no-code, object-missing, and mixed customer-quality lanes as coaching / process review rather than dispute lanes.\n\n### Priority 2 - Tighten customer execution\n- Re-coach wrong-address and instruction-note execution with the exact top complaint drivers first.\n- Audit proof-of-delivery behavior on exception stops that also appear in complaint or DSB rows.\n\n### Priority 3 - Close concentrated driver/process risk\n- Review the top DCR outliers for route-planning, RTS-code, and end-of-route decision quality.\n- Review the highest safety-event driver(s) this week and any unacknowledged escalation rows.\n- Review failed-pickup drivers for late-dispatch, incorrect-geo, and network-service patterns before next week closes.\n\n### Priority 4 - Tighten maintenance discipline\n- Audit the shortest DVIC completions and reset expectations for complete pre-trip inspections.\n- Keep weekly watch on sub-30-second inspection volume so it does not become normalized.\n\n## Bottom Line\nWeek {week_num} was a **{bottom_descriptor} operating week**; {bottom_status}. The places that can still leak cost are **{bottom_risks}**. The right read is: keep the fleet-level operating rhythm, but attack the small clusters before they harden into recurring scorecard loss.\n"


def dispute_label(driver: dict[str, object]) -> str:
    if driver.get('metric') == 'PSB':
        return f"{driver['name']} - pickup issue validation queue"
    return f"{driver['name']} - {'business-closed DCR subset' if driver['type'] == 'file' else 'business-closed attribution validation review'}"


def pickup_reconciliation_text(candidate: dict[str, object]) -> str:
    tasks = int(candidate.get('captured_rows', 0))
    stops = int(candidate.get('captured_stops', 0))
    failed = int(candidate.get('failed_stops', 0))
    labels = ', '.join(str(label) for label in candidate.get('stop_labels', []))
    if candidate.get('exact_stop_match'):
        return f'Execution captured {tasks} failed pickup task(s) at {stops} unique stop(s), matching the {failed} official failed stop(s): {labels}.'
    suffix = f' Candidate stops: {labels}.' if labels else ''
    return f'Execution captured {tasks} failed pickup task(s) at {stops} unique stop(s), which does not uniquely reconcile to the {failed} official failed stop(s).{suffix}'


def timing_assessment_for_row(current: dict[str, object], row: dict[str, str]) -> dict[str, str | bool]:
    tracking_id = (row.get('Tracking ID') or '').strip()
    timing_lookup = current['dispute_inputs'].get('business_closed_timing_by_tba', {})
    if isinstance(timing_lookup, dict):
        assessment = timing_lookup.get(tracking_id)
        if isinstance(assessment, dict):
            return assessment
    return {
        'status': 'missing',
        'is_ready': False,
        'summary': 'Timing evidence missing for scheduled delivery time versus Business Closed scan.',
        'scheduled_delivery_time': '',
        'business_closed_time': '',
        'evidence_source': '',
        'notes': '',
    }


def dispute_candidate_details(candidate: dict[str, object], week_num: str) -> dict[str, object]:
    if candidate.get('metric') == 'PSB':
        why = str(candidate.get('validation_reason') or 'Pickup issue surfaced in PSB summary rows, but stop-level proof is still missing.')
        wording = str(candidate.get('recommended_wording') or (
            f'Week {week_num} pickup issue review for {candidate["name"]}. Hold submission until the stop IDs, '
            'supporting geo / dispatch / network evidence, and the exact PSB dispute reason are validated.'
        ))
        prep = list(candidate.get('internal_prep') or [
            'pull the exact failed pickup stop IDs',
            'confirm whether the lane is geo-location, late-dispatch, road-closure, or network-service related',
            'attach geo mismatch screenshots or carrier/network proof when applicable',
        ])
        captured_stops = int(candidate.get('captured_stops', 0))
        exact_stop_match = bool(candidate.get('exact_stop_match'))
        if exact_stop_match:
            filing_status = 'Stop count reconciled — validate dispute reason and supporting proof before filing'
        elif captured_stops:
            filing_status = 'Stop evidence captured — scored-stop reconciliation still required'
        else:
            filing_status = 'Needs stop-level evidence before any portal submission'
        return {
            'why': why,
            'wording': wording,
            'prep': prep,
            'filing_status': filing_status,
        }
    if candidate['type'] == 'file':
        why = 'This is the cleanest filing lane because the RTS detail shows business-closed packages with Impact DCR = Y, no exemption applied, and timing evidence that passes the scheduled-delivery screen.'
        wording = f'Please review the attached Week {week_num} DCR-impacting BUSINESS CLOSED packages for {candidate["name"]}. We are requesting review only for the business-closed subset because these packages show Impact DCR = Y, no exemption applied, and timing evidence that supports the Business Closed coding in the week {week_num} RTS detail.'
        prep = [
            'pull business hours proof for each stop',
            'confirm scheduled delivery time versus the Business Closed timestamp for each TBA',
            'exclude non-business-closed RTS rows from the submission set',
        ]
        filing_status = 'Ready to file after evidence pull'
    else:
        why = str(candidate.get('validation_reason') or 'The score summary shows business-closed volume, but the RTS detail needs attribution reconciliation before a clean filing exists.')
        wording = f'Week {week_num} RTS confirms the BUSINESS CLOSED row for {candidate["name"]} is DCR-impacting and has no exemption applied. Delivery Execution did not return both the scheduled delivery time and Business Closed scan time for the listed TBA, so hold submission until that portal timing evidence is available.'
        prep = [
            'retain the qualifying RTS row already captured for the exact TBA',
            'retry the Delivery Execution lookup for scheduled delivery time and Business Closed scan time',
            'hold filing until timing validity is confirmed',
        ]
        filing_status = 'Validation review only — do not formally file yet'
    return {
        'why': why,
        'wording': wording,
        'prep': prep,
        'filing_status': filing_status,
    }


def dispute_guardrail_sections(current: dict[str, object]) -> list[str]:
    oodt_lane = current['rts']['oodt_by_driver'].most_common(1)
    no_code_lane = current['rts']['no_code_by_driver'].most_common(1)
    object_missing_lane = current['rts']['object_missing_by_driver'].most_common(1)
    business_closed_hold_notes = current['rts'].get('business_closed_hold_notes', {})

    do_not_file = []
    for transporter_id, notes in sorted(business_closed_hold_notes.items(), key=lambda item: current['name_by_id'].get(item[0], item[0]).lower()):
        unique_notes = []
        for note in notes:
            if note not in unique_notes:
                unique_notes.append(note)
        hold_count = len(current['dispute_inputs'].get('business_closed_hold', {}).get(transporter_id, []))
        if hold_count <= 0:
            continue
        timing_failed = any(' after the scheduled delivery time ' in f' {note.lower()} ' for note in unique_notes)
        reason = (
            f'{hold_count} DCR-impacting BUSINESS CLOSED rows failed the scheduled-delivery timing check.'
            if timing_failed else
            f'{hold_count} DCR-impacting BUSINESS CLOSED rows have incomplete portal timing evidence.'
        )
        do_not_file.append(
            f"### {current['name_by_id'].get(transporter_id, transporter_id)} - do not file\n- **Reason:** {reason}\n- **Read:** {' '.join(unique_notes)} Hold these TBAs out of the dispute portal unless timing evidence changes.\n"
        )
    if oodt_lane:
        transporter_id, count = oodt_lane[0]
        do_not_file.append(
            f"### {current['name_by_id'].get(transporter_id, transporter_id)} - do not file\n- **Reason:** {count} DCR-impacting rows are **OUT OF DRIVING TIME**.\n- **Read:** Route-planning / dispatch / execution issue, not a clean dispute lane.\n"
        )
    if no_code_lane:
        transporter_id, count = no_code_lane[0]
        extra = ''
        if object_missing_lane and object_missing_lane[0][0] == transporter_id:
            extra = f" with **{object_missing_lane[0][1]}** OBJECT MISSING detail rows"
        do_not_file.append(
            f"### {current['name_by_id'].get(transporter_id, transporter_id)} - do not file\n- **Reason:** {count} DCR-impacting rows are **NO RTS CODE SELECTED**{extra}.\n- **Read:** Process-control / coding-discipline issue, not a strong dispute case.\n"
        )
    if current['coaching_cluster_names']:
        do_not_file.append(
            f"### CDF / DSB cluster - coach first\n- **Reason:** The biggest leakage is still customer quality and small scan-quality defects, not a broad high-confidence exemption batch.\n- **Read:** Keep **{', '.join(current['coaching_cluster_names'][:6])}** in coaching / validation lanes rather than broad dispute filing.\n"
        )
    return do_not_file


def build_disputes_markdown(current: dict[str, object], max_candidates: int) -> str:
    prepared = dt.date.today().isoformat()
    week_num = current['week_num']
    candidates = current['disputes'][:max_candidates]

    dcr_candidates = [candidate for candidate in candidates if candidate.get('metric') == 'DCR']
    pickup_candidates = [candidate for candidate in candidates if candidate.get('metric') == 'PSB']

    if not candidates:
        executive = 'No high-confidence dispute lane stands out in the available week data. Treat the week as coaching-first unless additional proof changes the attribution picture.'
    elif dcr_candidates and dcr_candidates[0]['type'] == 'file':
        executive = 'This is a selective dispute week: file only the business-closed DCR subset that also passes the scheduled-delivery timing check, then use validation review on any summary-vs-detail mismatches instead of broad submissions.'
    elif pickup_candidates:
        executive = 'This week needs a split read: keep the DCR lane selective, and move pickup issues into dispute prep only after stop-level PSB evidence is gathered.'
    else:
        executive = 'This is mostly a validation-review week. The summary suggests some business-closed value, but the RTS detail does not yet support high-confidence filings after the timing screen.'

    sections = []
    for idx, candidate in enumerate(candidates, start=1):
        tbas = ', '.join(candidate['tbas'][:5]) if candidate['tbas'] else 'No TBAs surfaced in detail export'
        details = dispute_candidate_details(candidate, week_num)
        if candidate.get('metric') == 'DCR':
            support_summary = (
                f"  - DCR summary shows **{candidate['dcr'] or 'n/a'}** with **{candidate['controllable_summary']}** DA-controllable RTS packages and **{candidate['business_closed_summary']}** business-closed packages.\n"
                f"  - Relevant TBAs: **{tbas}**.\n"
                f"  - Impact-code mix on the driver: **{json.dumps(candidate.get('rts_codes', {}), sort_keys=True)}**.\n"
            )
        else:
            support_summary = (
                f"  - PSB summary row shows **{candidate.get('failed_stops', 0)}** failed pickup stops out of **{candidate.get('pickup_stops', 0)}** total pickup stops with PSB **{candidate.get('psb') or 'n/a'}**.\n"
                f"  - {pickup_reconciliation_text(candidate)}\n"
                f"  - Disputability read: **{candidate.get('disputable_read') or 'No clean PSB dispute angle confirmed yet.'}**\n"
            )
        sections.append(
            f"### {idx}) {dispute_label(candidate)}\n"
            f"- **Priority:** {idx}\n"
            f"- **Confidence:** {candidate['confidence']:.1f}/10\n"
            f"- **Metric:** {candidate.get('metric', 'DCR')}\n"
            f"- **Driver / Transporter ID:** {candidate['name']} / {candidate['transporter_id']}\n"
            f"- **Status:** {details['filing_status']}\n"
            f"- **Why this is ranked here:** {details['why']}\n"
            f"- **Supporting evidence summary:**\n"
            f"{support_summary}"
            f"- **Recommended wording:**\n"
            f"  - \"{details['wording']}\"\n"
            f"- **Recommended internal prep:**\n"
            + ''.join(f"  - {item}\n" for item in details['prep'])
        )

    do_not_file = dispute_guardrail_sections(current)
    ranked_list = '\n'.join(f'{idx + 1}. **{dispute_label(candidate)}**' for idx, candidate in enumerate(candidates)) if candidates else '1. **No high-confidence dispute submission identified**'

    return f"# Week {week_num} Disputes\n\n**DSP:** JECS  \n**Station:** DFH7  \n**Week:** {current['week_label']}  \n**Prepared:** {prepared}\n\n## Executive Dispute Read\n{executive}\n\n## Ranked Submission Priority\n{chr(10).join(sections) if sections else 'No ranked dispute candidates generated from the available week files.'}\n\n## Do Not File / Coaching-First Lanes\n{chr(10).join(do_not_file) if do_not_file else 'No additional coaching-first lanes identified from RTS detail.'}\n\n## Recommended Submission Order\n{ranked_list}\n\n## Bottom Line\nThe right Week {week_num} dispute posture is: **small batch only, file business-closed evidence only when the timing screen passes, move pickup issues into validation prep until stop-level PSB proof is attached, and keep OODT / no-code / object-missing / customer-quality issues in coaching and process-review lanes.**\n"


def build_dispute_packet_markdown(current: dict[str, object], max_candidates: int) -> str:
    prepared = dt.date.today().isoformat()
    week_num = current['week_num']
    candidates = current['disputes'][:max_candidates]
    guardrails = dispute_guardrail_sections(current)

    lines = [
        f"# Week {week_num} Dispute Packet",
        '',
        '**DSP:** JECS  ',
        '**Station:** DFH7  ',
        f"**Week:** {current['week_label']}  ",
        f"**Prepared:** {prepared}",
        '',
        '## Filing Read',
        'Use this packet to work the exact dispute queue in order: file only the clean business-closed DCR cases that pass the timing screen, hold validation-only cases until attribution is confirmed, and move pickup issues into dispute prep only after stop-level PSB proof is attached.',
        '',
        '## Submission Checklist',
        '- Pull the exact TBA list and confirm each package belongs to the scorecard week.',
        '- Attach business-hours proof, scheduled-delivery timing, and any supporting portal screenshots.',
        '- Attach stop IDs, geo / dispatch / carrier evidence, and screenshots before treating pickup issues as PSB dispute candidates.',
        '- Keep business-closed filing rows separate from no-code, OODT, object-missing, or pickup-validation rows.',
        '- Paste the recommended wording exactly, then adjust only for evidence specifics.',
        '',
        '## Candidate Filing Packets',
        '',
    ]

    if not candidates:
        lines.append('No high-confidence dispute packet candidates were generated from the available week files.')
        lines.append('')
    else:
        for idx, candidate in enumerate(candidates, start=1):
            details = dispute_candidate_details(candidate, week_num)
            tbas = candidate['tbas'][:10]
            lines.append(f"### {idx}) {dispute_label(candidate)}")
            lines.append(f"- **Filing status:** {details['filing_status']}")
            lines.append(f"- **Confidence:** {candidate['confidence']:.1f}/10")
            lines.append(f"- **Metric:** {candidate.get('metric', 'DCR')}")
            lines.append(f"- **Driver / Transporter ID:** {candidate['name']} / {candidate['transporter_id']}")
            lines.append(f"- **Why this case exists:** {details['why']}")
            if candidate.get('metric') == 'DCR':
                lines.append(f"- **Summary evidence:** DCR **{candidate['dcr'] or 'n/a'}**, **{candidate['controllable_summary']}** DA-controllable RTS, **{candidate['business_closed_summary']}** business-closed packages.")
                lines.append(f"- **Impact-code mix:** {json.dumps(candidate.get('rts_codes', {}), sort_keys=True)}")
                lines.append(f"- **TBAs to work:** {', '.join(tbas) if tbas else 'No TBAs surfaced in detail export'}")
                lines.append('- **Evidence to attach:**')
                lines.extend([
                    '  - scorecard summary screenshot',
                    '  - RTS detail screenshot/export rows for the exact TBAs',
                    '  - business-hours proof / stop information',
                    '  - route timing and attempt confirmation',
                ])
            else:
                lines.append(f"- **Summary evidence:** PSB **{candidate.get('psb') or 'n/a'}**, **{candidate.get('failed_stops', 0)}** failed pickup stops on **{candidate.get('pickup_stops', 0)}** total pickup stops.")
                lines.append(f"- **Stop reconciliation:** {pickup_reconciliation_text(candidate)}")
                lines.append(f"- **Disputability read:** {candidate.get('disputable_read') or 'No clean PSB dispute angle confirmed yet.'}")
                lines.append("- **Stop IDs to work:** not yet surfaced in the weekly PSB export")
                lines.append('- **Evidence to attach before any filing:**')
                lines.extend([
                    '  - failed pickup stop IDs',
                    '  - geo mismatch screenshots if applicable',
                    '  - dispatch timing proof if the lane was late-dispatch driven',
                    '  - carrier / network proof if service failure drove the miss',
                ])
            lines.append('- **Recommended wording:**')
            lines.append(f"> {details['wording']}")
            lines.append('- **Owner prep before submit:**')
            lines.extend(f"  - {item}" for item in details['prep'])
            lines.append('')

    lines.append('## Hold / Do-Not-File Lanes')
    lines.append('')
    lines.append(chr(10).join(guardrails) if guardrails else 'No additional do-not-file lanes identified from the available week data.')
    lines.append('')
    lines.append('## Bottom Line')
    lines.append(f'Work this packet in order. For Week {week_num}, file only the clean business-closed DCR subset(s) that pass the timing screen, keep attribution-mismatch cases in validation review until reconciled, move pickup issues only after stop-level PSB proof is attached, and leave customer-quality / no-code / OODT lanes out of the dispute portal.')
    lines.append('')
    return '\n'.join(lines)


VERIFIED_DCR_REASONS = {
    'holiday': 'Business closed due to federal/local holiday',
    'business_closed': 'Business closed',
}
DEFAULT_MAX_DISPUTE_CANDIDATES = 3
MAX_DISPUTE_REVIEW_FILE_CANDIDATES = 3


def nth_weekday_of_month(year: int, month: int, weekday: int, occurrence: int) -> dt.date:
    first = dt.date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + dt.timedelta(days=offset + (occurrence - 1) * 7)


def last_weekday_of_month(year: int, month: int, weekday: int) -> dt.date:
    if month == 12:
        cursor = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        cursor = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    while cursor.weekday() != weekday:
        cursor -= dt.timedelta(days=1)
    return cursor


def us_federal_holidays(year: int) -> dict[dt.date, str]:
    return {
        dt.date(year, 1, 1): "New Year's Day",
        nth_weekday_of_month(year, 1, 0, 3): 'Martin Luther King Jr. Day',
        nth_weekday_of_month(year, 2, 0, 3): "Washington's Birthday",
        last_weekday_of_month(year, 5, 0): 'Memorial Day',
        dt.date(year, 6, 19): 'Juneteenth National Independence Day',
        dt.date(year, 7, 4): 'Independence Day',
        nth_weekday_of_month(year, 9, 0, 1): 'Labor Day',
        nth_weekday_of_month(year, 10, 0, 2): 'Columbus Day',
        dt.date(year, 11, 11): 'Veterans Day',
        nth_weekday_of_month(year, 11, 3, 4): 'Thanksgiving Day',
        dt.date(year, 12, 25): 'Christmas Day',
    }


def classify_business_closed_reason(date_text: str) -> dict[str, str]:
    try:
        planned_date = dt.date.fromisoformat(date_text)
    except ValueError:
        return {
            'status': 'ready_for_review',
            'bucket': 'business_closed',
            'reason': VERIFIED_DCR_REASONS['business_closed'],
            'weekday': 'Unknown',
            'evidence_status': 'guide-backed DCR reason is Business closed; planned delivery date could not be parsed for holiday verification',
        }

    holiday_name = us_federal_holidays(planned_date.year).get(planned_date)
    if holiday_name:
        return {
            'status': 'ready_for_review',
            'bucket': 'holiday',
            'reason': VERIFIED_DCR_REASONS['holiday'],
            'weekday': planned_date.strftime('%A'),
            'evidence_status': f'guide-backed DCR holiday reason; planned date matched {holiday_name}',
        }
    return {
        'status': 'ready_for_review',
        'bucket': 'business_closed',
        'reason': VERIFIED_DCR_REASONS['business_closed'],
        'weekday': planned_date.strftime('%A'),
        'evidence_status': 'guide-backed DCR reason is Business closed',
    }


def dispute_submission_key(name: str, bucket: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f'{slug}-{bucket}'


def split_candidate_submission_groups(current: dict[str, object], candidate: dict[str, object]) -> list[dict[str, object]]:
    all_rows = current['dispute_inputs']['business_closed_ready'].get(candidate['transporter_id'], [])
    grouped: dict[str, dict[str, object]] = {}
    for row in all_rows:
        planned_date = (row.get('Planned Delivery Date') or '').strip()
        classification = classify_business_closed_reason(planned_date)
        bucket = classification['bucket']
        group = grouped.setdefault(bucket, {
            'status': classification['status'],
            'reason': classification['reason'],
            'weekday': classification['weekday'],
            'evidence_status': classification['evidence_status'],
            'rows': [],
        })
        group['rows'].append(row)
    ordered_groups = []
    for bucket in ['holiday', 'business_closed']:
        group = grouped.get(bucket)
        if group:
            ordered_groups.append({
                'bucket': bucket,
                'submission_key': dispute_submission_key(str(candidate['name']), bucket),
                **group,
            })
    return ordered_groups


def split_candidate_review_groups(current: dict[str, object], candidate: dict[str, object]) -> list[dict[str, object]]:
    if candidate['type'] == 'file':
        base_rows = current['dispute_inputs']['business_closed_ready'].get(candidate['transporter_id'], [])
        status = 'ready_for_review'
        submission_suffix = None
        default_blocking_issue = None
    else:
        base_rows = current['dispute_inputs']['business_closed_hold'].get(candidate['transporter_id'], [])
        status = 'needs_additional_validation'
        submission_suffix = 'validation'
        default_blocking_issue = str(candidate.get('validation_reason') or 'Additional timing validation is required before any submission.')

    grouped: dict[str, dict[str, object]] = {}
    for row in base_rows:
        planned_date = (row.get('Planned Delivery Date') or '').strip()
        classification = classify_business_closed_reason(planned_date)
        bucket = classification['bucket']
        timing = timing_assessment_for_row(current, row)
        group = grouped.setdefault(bucket, {
            'status': status,
            'reason': classification['reason'],
            'weekday': classification['weekday'],
            'evidence_status': classification['evidence_status'] if candidate['type'] == 'file' else str(timing.get('summary') or default_blocking_issue or classification['evidence_status']),
            'rows': [],
            'blocking_notes': [],
        })
        group['rows'].append(row)
        if candidate['type'] != 'file':
            note = str(timing.get('summary') or default_blocking_issue or '').strip()
            if note and note not in group['blocking_notes']:
                group['blocking_notes'].append(note)

    ordered_groups = []
    for bucket in ['holiday', 'business_closed']:
        group = grouped.get(bucket)
        if group:
            suffix = bucket if submission_suffix is None else f'{bucket}-{submission_suffix}'
            ordered_groups.append({
                'bucket': bucket,
                'submission_key': dispute_submission_key(str(candidate['name']), suffix),
                'blocking_issue': ' '.join(group['blocking_notes']) if group['blocking_notes'] else default_blocking_issue,
                **group,
            })
    return ordered_groups


def build_submission_payload(current: dict[str, object], candidate: dict[str, object], group: dict[str, object]) -> dict[str, object]:
    tbas = [row.get('Tracking ID', '').strip() for row in group['rows'] if row.get('Tracking ID')]
    first_date = next(((row.get('Planned Delivery Date') or '').strip() for row in group['rows'] if (row.get('Planned Delivery Date') or '').strip()), '')
    driver_name = str(candidate['name'])
    if group['bucket'] == 'holiday' and first_date:
        detail_sentence = f'The RTS row is coded BUSINESS CLOSED, shows Impact DCR = Y, shows No Exemption Applied, and the planned delivery date matched the holiday on {first_date}.'
        appeal_details = f"Week {current['week_num']} DCR review request for {driver_name}. Please review only BUSINESS CLOSED package {tbas[0]}. {detail_sentence}"
    else:
        tba_list = ', '.join(tbas)
        appeal_details = f"Week {current['week_num']} DCR review request for {driver_name}. Please review only the BUSINESS CLOSED subset for TBAs {tba_list}. Each RTS row is coded BUSINESS CLOSED, shows Impact DCR = Y, and shows No Exemption Applied."
    return {
        'dspId': 'JECS',
        'station': 'DFH7',
        'metric': 'Delivery Completion Rate (DCR)',
        'reason': group['reason'],
        'appealDetails': appeal_details,
        'appealedWeek': current['week_label'],
        'tba_ids': '\n'.join(tbas),
    }


def build_dispute_review_entries(current: dict[str, object], max_candidates: int) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    priority = 1
    week_number_int = int(current['week_num'])
    rts_source = f'Quality_RTS_JECS_DFH7_{current["year"]}-W{week_number_int:02d}.csv'
    dcr_source = f'Quality_DCR_JECS_DFH7_{current["year"]}-W{week_number_int:02d}.csv'
    scorecard_pdf = f'US_JECS_DFH7_Week{week_number_int}_{current["year"]}_en_DSPScorecard.pdf'
    preview_pdf = f'US_JECS_DFH7_Week{week_number_int}_{current["year"]}_en_DSPScorecardPreview.pdf'
    ranked_review_candidates = [candidate for candidate in current['disputes'] if candidate.get('metric') == 'DCR'][:max_candidates]
    for candidate in ranked_review_candidates:
        for group in split_candidate_review_groups(current, candidate):
            payload = build_submission_payload(current, candidate, group)
            entries.append({
                'priority': priority,
                'submissionKey': group['submission_key'],
                'status': group['status'],
                'driverName': candidate['name'],
                'transporterId': candidate['transporter_id'],
                'metric': payload['metric'],
                'reason': payload['reason'],
                'appealedWeek': payload['appealedWeek'],
                'tba_ids': [row.get('Tracking ID', '').strip() for row in group['rows'] if row.get('Tracking ID')],
                'appealDetails': payload['appealDetails'],
                'evidenceSources': [
                    rts_source,
                    dcr_source,
                    scorecard_pdf,
                    preview_pdf,
                    'data/scorecard_data/2026-wk21/week21-business-closed-refile-log.json',
                ] + ([str(current['dispute_inputs']['business_closed_timing_source'])] if current['dispute_inputs'].get('business_closed_timing_source') else []),
                'evidenceStatus': group['evidence_status'],
                'bucket': group['bucket'],
                'dcr': candidate['dcr'],
                'controllableSummary': candidate['controllable_summary'],
                'businessClosedSummary': candidate['business_closed_summary'],
                'rows': group['rows'],
                'blockingIssue': group.get('blocking_issue'),
            })
            priority += 1
    return entries


def build_dispute_review_markdown(current: dict[str, object], entries: list[dict[str, object]]) -> str:
    prepared = dt.date.today().isoformat()
    week_number_int = int(current['week_num'])
    rts_source = f'Quality_RTS_JECS_DFH7_{current["year"]}-W{week_number_int:02d}.csv'
    dcr_source = f'Quality_DCR_JECS_DFH7_{current["year"]}-W{week_number_int:02d}.csv'
    lines = [
        f"# Week {current['week_num']} Amazon Dispute Review",
        '',
        '**DSP:** JECS  ',
        '**Station:** DFH7  ',
        f"**Week:** {current['week_label']}  ",
        f"**Prepared:** {prepared}  ",
        '**Purpose:** Review these dispute packets before any portal submission.',
        '',
        '## How this folder should be used',
        '- This folder is the pre-submission workspace for the active week disputes.',
        '- Nothing here has been submitted to Amazon.',
        '- The exact portal payloads are listed below so you can review the category, subcategory, TBAs, wording, and evidence set before any submission step.',
        '',
        '## Review queue',
    ]
    if not entries:
        lines.extend(['', 'No dispute-review entries were generated from the available week data.', ''])
    else:
        for entry in entries:
            title_bucket = 'holiday' if entry['bucket'] == 'holiday' else 'standard'
            lines.extend([
                '',
                f"### {entry['priority']}. {entry['driverName']} - {title_bucket} business-closed {'submission' if entry['status'] == 'ready_for_review' else 'validation review'}",
                f"- **Status:** {'Ready for review' if entry['status'] == 'ready_for_review' else 'Needs additional validation'}",
                f"- **Submission key:** `{entry['submissionKey']}`",
                f"- **Portal category / metric:** `{entry['metric']}`",
                f"- **Portal subcategory / reason:** `{entry['reason']}`",
                f"- **Driver summary evidence:** DCR `{entry['dcr'] or 'n/a'}`, `{entry['controllableSummary']}` DA-controllable RTS, `{entry['businessClosedSummary']}` RTS Business Closed.",
                f"- **TBA set:** `{', '.join(entry['tba_ids'])}`",
                '- **Exact portal payload:**' if entry['status'] == 'ready_for_review' else '- **Draft portal payload (do not submit yet):**',
                '',
                '```json',
                json.dumps({
                    'dspId': 'JECS',
                    'station': 'DFH7',
                    'metric': entry['metric'],
                    'reason': entry['reason'],
                    'appealDetails': entry['appealDetails'],
                    'appealedWeek': entry['appealedWeek'],
                    'tba_ids': '\n'.join(entry['tba_ids']),
                }, indent=2),
                '```',
                '',
                '- **Evidence to attach at submission time:**',
                f'  - week DCR summary row for the driver from `{dcr_source}`',
                f'  - the exact RTS rows from `{rts_source}`',
                '  - scorecard PDF or preview PDF screenshot showing week context',
                '  - business-hours / holiday support when available',
            ])
            if entry['blockingIssue']:
                lines.append(f"- **Review note:** {entry['blockingIssue']}")

    pickup_candidates = current.get('pickup_disputes', [])
    lines.extend([
        '',
        '## Pickup Issue Validation Backlog',
    ])
    if pickup_candidates:
        lines.append('- These PSB lanes remain in dispute prep until captured Execution stops reconcile to the official scorecard count and a guide-backed dispute reason is proven.')
        for candidate in pickup_candidates:
            pickup_details = dispute_candidate_details(candidate, str(current['week_num']))
            lines.extend([
                '',
                f"### {candidate['name']} - pickup issue validation",
                f"- **Status:** {pickup_details['filing_status']}",
                f"- **Metric:** `{candidate.get('metric', 'PSB')}`",
                f"- **Summary evidence:** PSB `{candidate.get('psb') or 'n/a'}`, `{candidate.get('failed_stops', 0)}` failed pickup stops on `{candidate.get('pickup_stops', 0)}` total pickup stops.",
                f"- **Stop reconciliation:** {pickup_reconciliation_text(candidate)}",
                f"- **Read:** {candidate.get('validation_reason')}",
                f"- **Disputability read:** {candidate.get('disputable_read') or 'No clean PSB dispute angle confirmed yet.'}",
                '- **Still needed:** scored-stop reconciliation plus geo, dispatch, or carrier proof for the selected guide-backed dispute reason.',
            ])
    else:
        lines.append('No pickup issue validation backlog was generated from the available PSB rows.')

    ready_count = sum(1 for entry in entries if entry['status'] == 'ready_for_review')
    blocked_count = sum(1 for entry in entries if entry['status'] != 'ready_for_review')
    lines.extend([
        '',
        '## Recommendation',
        f"- `{ready_count}` packet(s) are fully specified and ready for review.",
        f"- `{blocked_count}` packet(s) still need timing or attribution validation before submission.",
        f"- `{len(pickup_candidates)}` pickup issue lane(s) still need stop-level PSB evidence before they can move from dispute prep into any portal review queue.",
        '- Submit the guide-backed `Business closed` reason for standard business-hours closures only when the timing evidence does not place the Business Closed mark after the scheduled delivery time; use the holiday-specific reason only when the planned date matches a federal/local holiday.',
        '',
    ])
    return '\n'.join(lines)


def build_dispute_review_json(entries: list[dict[str, object]]) -> str:
    payload = []
    for entry in entries:
        payload.append({
            'priority': entry['priority'],
            'submissionKey': entry['submissionKey'],
            'status': entry['status'],
            'driverName': entry['driverName'],
            'transporterId': entry['transporterId'],
            'metric': entry['metric'],
            'reason': entry['reason'],
            'appealedWeek': entry['appealedWeek'],
            'tba_ids': entry['tba_ids'],
            'appealDetails': entry['appealDetails'],
            'evidenceSources': entry['evidenceSources'],
            'evidenceStatus': entry['evidenceStatus'],
            'blockingIssue': entry['blockingIssue'],
        })
    return json.dumps(payload, indent=2) + '\n'


def build_dispute_review_csv(current: dict[str, object], entries: list[dict[str, object]]) -> str:
    headers = [
        'priority',
        'submission_key',
        'status',
        'driver_name',
        'transporter_id',
        'tracking_id',
        'planned_delivery_date',
        'weekday',
        'scheduled_delivery_time',
        'business_closed_time',
        'timing_status',
        'timing_note',
        'metric',
        'portal_subcategory',
        'evidence_status',
        'impact_dcr',
        'da_selected_rts_code',
        'exemption_reason',
        'service_area',
        'source_file',
    ]
    lines = [','.join(headers)]
    for entry in entries:
        for row in entry['rows']:
            classification = classify_business_closed_reason((row.get('Planned Delivery Date') or '').strip())
            timing = timing_assessment_for_row(current, row)
            values = [
                str(entry['priority']),
                str(entry['submissionKey']),
                str(entry['status']),
                str(entry['driverName']),
                str(entry['transporterId']),
                str(row.get('Tracking ID', '').strip()),
                str(row.get('Planned Delivery Date', '').strip()),
                classification['weekday'],
                str(timing.get('scheduled_delivery_time', '')),
                str(timing.get('business_closed_time', '')),
                str(timing.get('status', '')),
                str(timing.get('summary', '')),
                str(entry['metric']),
                str(entry['reason']),
                str(entry['evidenceStatus']),
                str(row.get('Impact DCR', '').strip()),
                str(row.get('DA Selected RTS Code', '').strip()),
                str(row.get('Exemption Reason', '').strip()),
                str(row.get('Service Area', '').strip()),
                str(next((source for source in entry['evidenceSources'] if source.startswith('Quality_RTS_')), '')),
            ]
            escaped = []
            for value in values:
                text = value.replace('"', '""')
                if any(ch in text for ch in [',', '"', '\n']):
                    text = f'"{text}"'
                escaped.append(text)
            lines.append(','.join(escaped))
    return '\n'.join(lines) + '\n'


def write_dispute_evidence_outputs(week_folder: Path, current: dict[str, object], entries: list[dict[str, object]]) -> list[Path]:
    dispute_dir = week_folder / 'dispute'
    evidence_dir = dispute_dir / 'evidence'
    evidence_dir.mkdir(parents=True, exist_ok=True)
    pickup_bundle_path = dispute_dir / f"week{current['week_num']}-pickup-evidence.md"

    week_number_int = int(current['week_num'])
    dcr_source = require_file(week_folder, 'Quality_DCR')
    rts_source = require_file(week_folder, 'Quality_RTS')
    psb_source = require_file(week_folder, 'Quality_PSB')
    dcr_rows = read_csv_rows(dcr_source)
    rts_rows = read_csv_rows(rts_source)
    psb_rows = read_csv_rows(psb_source)
    dcr_by_id = {row.get('Transporter ID', '').strip(): row for row in dcr_rows if row.get('Transporter ID')}
    psb_by_id = {row.get('Transporter ID', '').strip(): row for row in psb_rows if row.get('Transporter ID')}

    scorecard_pdf = next((path for path in find_all(week_folder, '_en_DSPScorecard') if 'preview' not in path.name.lower()), None)
    dcr_overview_png = evidence_dir / f"week{current['week_num']}-scorecard-dcr-overview.png"
    if scorecard_pdf and not dcr_overview_png.exists():
        overview_page = find_pdf_page(scorecard_pdf, ['delivery completion rate', current['week_label'].lower()])
        if overview_page is not None:
            render_pdf_page_thumbnail(scorecard_pdf, overview_page, dcr_overview_png)

    evidence_lines = [
        f"# Week {current['week_num']} Dispute Evidence Bundle",
        '',
        '**Purpose:** Store the evidence gathered during dispute creation, not just the submission wording.',
        '',
        '## Evidence Rules',
        '- Business-hours proof and Cortex / itinerary screenshots should be captured for business-closed disputes whenever live portal access is available.',
        '- Frozen weekly exports do not include the stop business name, customer address, or live Cortex view, so those items remain blocked until a live portal lookup is possible.',
        '- This file shows what was gathered locally and what still needs live follow-up before submission.',
        '',
        '## Week-Level Evidence',
    ]
    if dcr_overview_png.exists():
        evidence_lines.append(f"- Scorecard DCR overview screenshot: `{evidence_file_rel(dcr_overview_png, week_folder)}`")
    else:
        evidence_lines.append('- Scorecard DCR overview screenshot: not generated from local PDFs in this run.')
    timing_source = current['dispute_inputs'].get('business_closed_timing_source')
    if timing_source:
        evidence_lines.append(f"- Business-closed timing evidence CSV: `{evidence_file_rel(Path(timing_source), week_folder)}`")
    else:
        evidence_lines.append('- Business-closed timing evidence CSV: not available in this run; standard business-closed disputes stay blocked without it.')
    pickup_stop_rows_by_id, pickup_stop_source = load_pickup_stop_evidence(week_folder, str(current['week_num']))

    if not entries:
        evidence_lines.extend(['', 'No dispute-review entries were generated from the available week data.', ''])
    else:
        for entry in entries:
            transporter_id = str(entry['transporterId'])
            submission_key = str(entry['submissionKey'])
            entry_slug = slugify(submission_key)
            driver_slug = slugify(str(entry['driverName']))
            dcr_row = dcr_by_id.get(transporter_id, {})

            dcr_row_path = evidence_dir / f'{entry_slug}-dcr-summary-row.csv'
            rts_rows_path = evidence_dir / f'{entry_slug}-rts-rows.csv'
            write_csv_dict_rows(dcr_row_path, [dcr_row] if dcr_row else [], list(dcr_row.keys()) if dcr_row else ['Transporter ID'])
            write_csv_dict_rows(rts_rows_path, [dict(row) for row in entry['rows']], list(entry['rows'][0].keys()) if entry['rows'] else ['Tracking ID'])

            driver_scorecard_png = evidence_dir / f'{entry_slug}-scorecard-driver-page.png'
            if scorecard_pdf and not driver_scorecard_png.exists():
                driver_page = find_pdf_page(scorecard_pdf, [transporter_id])
                if driver_page is not None:
                    render_pdf_page_thumbnail(scorecard_pdf, driver_page, driver_scorecard_png)

            daily_report_png = None
            first_planned_date = next(((row.get('Planned Delivery Date') or '').strip() for row in entry['rows'] if (row.get('Planned Delivery Date') or '').strip()), '')
            if first_planned_date:
                try:
                    day_code = dt.date.fromisoformat(first_planned_date).strftime('%a').upper()
                except ValueError:
                    day_code = ''
                daily_report_pdf = find_one(week_folder, f'DA-Daily-Report-{day_code}') if day_code else None
                if daily_report_pdf:
                    daily_report_png = evidence_dir / f'{entry_slug}-daily-report-{day_code.lower()}.png'
                    if not daily_report_png.exists():
                        daily_page = find_pdf_page(daily_report_pdf, [transporter_id])
                        if daily_page is not None:
                            render_pdf_page_thumbnail(daily_report_pdf, daily_page, daily_report_png)

            evidence_lines.extend([
                '',
                f"### {entry['priority']}. {entry['driverName']}",
                f"- **Submission key:** `{submission_key}`",
                f"- **Portal reason:** `{entry['reason']}`",
                f"- **TBA set:** `{', '.join(entry['tba_ids'])}`",
                '- **Local evidence gathered:**',
                f"  - DCR summary row CSV: `{evidence_file_rel(dcr_row_path, week_folder)}`",
                f"  - RTS detail CSV: `{evidence_file_rel(rts_rows_path, week_folder)}`",
                f"  - Scorecard DCR overview screenshot: `{evidence_file_rel(dcr_overview_png, week_folder)}`" if dcr_overview_png.exists() else '  - Scorecard DCR overview screenshot: not available from local rendering in this run',
                f"  - Driver scorecard screenshot: `{evidence_file_rel(driver_scorecard_png, week_folder)}`" if driver_scorecard_png.exists() else '  - Driver scorecard screenshot: not available from local rendering in this run',
                f"  - Daily report screenshot: `{evidence_file_rel(daily_report_png, week_folder)}`" if daily_report_png and daily_report_png.exists() else '  - Daily report screenshot: not available from local rendering in this run',
                '  - business-closed timing evidence rows from the local timing sidecar' if timing_source else '  - business-closed timing evidence rows: not available in this run',
                '- **Still required before submission:**',
                '  - business-hours proof for the exact stop/business tied to each TBA',
                '  - Cortex / itinerary screenshots for each TBA or stop-level lookup',
                f"- **Current blocker:** {entry.get('blockingIssue') or 'Business-hours proof and final portal evidence still need review before submission.'}",
            ])

    evidence_lines.extend([
        '',
        '## Pickup Issue Evidence Backlog',
    ])
    pickup_candidates = current.get('pickup_disputes', [])
    if not pickup_candidates:
        evidence_lines.extend(['- No pickup issue validation backlog was generated from the available PSB rows.', ''])
    else:
        for candidate in pickup_candidates:
            transporter_id = str(candidate['transporter_id'])
            entry_slug = slugify(f"{candidate['name']}-pickup-validation")
            psb_row = psb_by_id.get(transporter_id, {})
            psb_row_path = evidence_dir / f'{entry_slug}-psb-summary-row.csv'
            pickup_stop_rows = pickup_stop_rows_by_id.get(transporter_id, [])
            write_csv_dict_rows(psb_row_path, [psb_row] if psb_row else [], list(psb_row.keys()) if psb_row else ['Transporter ID'])
            evidence_lines.extend([
                '',
                f"### {candidate['name']}",
                f"- **Metric:** `PSB`",
                f"- **Summary evidence:** PSB `{candidate.get('psb') or 'n/a'}`, `{candidate.get('failed_stops', 0)}` failed pickup stops on `{candidate.get('pickup_stops', 0)}` total pickup stops.",
                f"- **Stop reconciliation:** {pickup_reconciliation_text(candidate)}",
                '- **Local evidence gathered:**',
                f"  - PSB summary row CSV: `{evidence_file_rel(psb_row_path, week_folder)}`",
                f"  - week-level PSB export: `{psb_source.name}`",
            ])
            if pickup_stop_rows and pickup_stop_source:
                evidence_lines.append(f"  - pickup stop evidence CSV: `{evidence_file_rel(pickup_stop_source, week_folder)}`")
                if pickup_bundle_path.exists():
                    evidence_lines.append(f"  - pickup evidence bundle: `{evidence_file_rel(pickup_bundle_path, week_folder)}`")
                artifact_paths: list[str] = []
                seen_artifacts: set[str] = set()
                for row in pickup_stop_rows:
                    for field_name in ('route_summaries_json_path', 'route_details_json_path', 'route_screenshot_path'):
                        artifact_path = (row.get(field_name) or '').strip()
                        if artifact_path and artifact_path not in seen_artifacts:
                            seen_artifacts.add(artifact_path)
                            artifact_paths.append(artifact_path)
                for artifact_path in artifact_paths:
                    evidence_lines.append(f"  - portal proof: `{artifact_path}`")
                evidence_lines.append('- **Pickup category details:**')
                for row in pickup_stop_rows:
                    route_code = (row.get('route_code') or '').strip() or 'unknown-route'
                    delivery_date = (row.get('delivery_date') or '').strip() or 'unknown-date'
                    stop_sequence = (row.get('stop_sequence') or '').strip()
                    stop_reference = (row.get('stop_reference') or '').strip()
                    tracking_id = (row.get('tracking_id') or '').strip()
                    stop_address_text = (row.get('stop_address_text') or '').strip()
                    failure_reason = titleize_token_text((row.get('task_state_context') or row.get('task_state') or '').strip()) or 'Unknown failure'
                    planned_time = (row.get('planned_time') or '').strip()
                    actual_time = (row.get('actual_time') or '').strip()
                    route_departure_time = (row.get('route_departure_time') or '').strip()
                    planned_rts_time = (row.get('planned_rts_time') or '').strip()
                    geo_lat = (row.get('execution_latitude') or '').strip()
                    geo_lng = (row.get('execution_longitude') or '').strip()
                    evidence_bits = [delivery_date, route_code]
                    if stop_sequence:
                        evidence_bits.append(f'stop {stop_sequence}')
                    if stop_reference:
                        evidence_bits.append(stop_reference)
                    if tracking_id:
                        evidence_bits.append(tracking_id)
                    if stop_address_text:
                        evidence_bits.append(stop_address_text)
                    detail_bits = [failure_reason]
                    if planned_time:
                        detail_bits.append(f'planned {planned_time}')
                    if actual_time:
                        detail_bits.append(f'actual {actual_time}')
                    if route_departure_time:
                        detail_bits.append(f'route departed {route_departure_time}')
                    if planned_rts_time:
                        detail_bits.append(f'planned RTS {planned_rts_time}')
                    if geo_lat and geo_lng:
                        detail_bits.append(f'geo {geo_lat}, {geo_lng}')
                    evidence_lines.append(f"  - {', '.join(evidence_bits)}: {'; '.join(detail_bits)}")
                evidence_lines.append('- **Related contact compliance check:**')
                for line in summarize_pickup_rts_rows(rts_rows, str(candidate['name']), transporter_id):
                    evidence_lines.append(f"  - {line}")
                evidence_lines.extend([
                    f"- **Disputability read:** {candidate.get('disputable_read') or 'No clean PSB dispute angle confirmed yet.'}",
                    '- **Still required before submission:**',
                    '  - reconcile the official PSB failed stop to one exact portal stop / task before submitting any pickup dispute',
                    '  - portal screenshot or Amazon stop-detail proof if a formal stop ID label is required',
                    '  - geo mismatch screenshots if applicable',
                    '  - dispatch timing proof if the lane was late-dispatch driven',
                    '  - carrier / network proof if service failure drove the miss',
                    '- **Current status:** Stop-level Execution evidence is captured. The remaining blocker is scorecard-stop reconciliation before any submission-ready PSB filing exists.',
                ])
            else:
                if pickup_bundle_path.exists():
                    evidence_lines.append(f"  - pickup evidence bundle: `{evidence_file_rel(pickup_bundle_path, week_folder)}`")
                evidence_lines.extend([
                    '- **Still required before submission:**',
                    '  - exact failed pickup stop IDs',
                    '  - geo mismatch screenshots if applicable',
                    '  - dispatch timing proof if the lane was late-dispatch driven',
                    '  - carrier / network proof if service failure drove the miss',
                    '- **Current blocker:** The weekly PSB export is summary-only, and the dedicated pickup fetch bundle should be checked for any live Execution auth or route-detail lookup blockers.',
                ])

    evidence_md_path = dispute_dir / f"week{current['week_num']}-evidence.md"
    evidence_md_path.write_text('\n'.join(evidence_lines) + '\n', encoding='utf-8')
    return [evidence_md_path]


def write_dispute_review_outputs(week_folder: Path, current: dict[str, object], force: bool, max_candidates: int) -> list[Path]:
    entries = build_dispute_review_entries(current, max_candidates)
    dispute_dir = week_folder / 'dispute'
    dispute_dir.mkdir(parents=True, exist_ok=True)
    md_path = dispute_dir / f"week{current['week_num']}-amazon-submission-review.md"
    json_path = dispute_dir / f"week{current['week_num']}-amazon-submission-review.json"
    csv_path = dispute_dir / f"week{current['week_num']}-dcr-business-closed-evidence.csv"
    if not force:
        existing = [str(path) for path in (md_path, json_path, csv_path) if path.exists()]
        if existing:
            raise FileExistsError(f'Refusing to overwrite existing dispute-review outputs without --force true: {", ".join(existing)}')
    md_path.write_text(build_dispute_review_markdown(current, entries), encoding='utf-8')
    json_path.write_text(build_dispute_review_json(entries), encoding='utf-8')
    csv_path.write_text(build_dispute_review_csv(current, entries), encoding='utf-8')
    evidence_paths = write_dispute_evidence_outputs(week_folder, current, entries)
    return [md_path, json_path, csv_path, *evidence_paths]


def ensure_week_folder(week_folder: Path) -> None:
    if not week_folder.is_dir():
        raise FileNotFoundError(f'Week folder not found: {week_folder}')


def load_week_context(week_folder: Path) -> tuple[dict[str, object], dict[str, object] | None]:
    ensure_week_folder(week_folder)
    current = analyze_week(week_folder)
    pickup_rows_by_id, pickup_source = load_pickup_stop_evidence(week_folder, str(current['week_num']))
    current['dispute_inputs']['pickup_stop_rows_by_id'] = pickup_rows_by_id
    current['dispute_inputs']['pickup_stop_source'] = pickup_source
    for candidate in current.get('pickup_disputes', []):
        transporter_id = str(candidate.get('transporter_id') or '')
        evidence_summary = classify_pickup_disputability(
            pickup_rows_by_id.get(transporter_id, []),
            int(candidate.get('failed_stops', 0)),
        )
        candidate.update(evidence_summary)
    prior_folder = prior_week_folder(week_folder)
    prior = None
    if prior_folder:
        try:
            prior = analyze_week(prior_folder)
        except FileNotFoundError:
            prior = None
    return current, prior


def summary_markdown_path(week_folder: Path, week_num: str) -> Path:
    return week_folder / f'week{week_num}-summary.md'


def disputes_markdown_path(week_folder: Path, week_num: str) -> Path:
    return week_folder / f'week{week_num}-disputes.md'


def write_markdown_output(path: Path, content: str, force: bool) -> Path:
    if not force and path.exists():
        raise FileExistsError(f'Refusing to overwrite existing output without --force true: {path}')
    path.write_text(content, encoding='utf-8')
    return path


def generate_summary_output(
    week_folder: Path,
    current: dict[str, object],
    prior: dict[str, object] | None,
    *,
    force: bool,
    render_pdf: bool,
) -> Path:
    summary_path = summary_markdown_path(week_folder, str(current['week_num']))
    write_markdown_output(summary_path, build_summary_markdown(current, prior), force)
    if render_pdf:
        render_pdfs([summary_path])
    return summary_path


def generate_disputes_output(
    week_folder: Path,
    current: dict[str, object],
    *,
    force: bool,
    render_pdf: bool,
    max_candidates: int,
) -> Path:
    disputes_path = disputes_markdown_path(week_folder, str(current['week_num']))
    write_markdown_output(disputes_path, build_disputes_markdown(current, max_candidates), force)
    if render_pdf:
        render_pdfs([disputes_path])
    return disputes_path


def render_pdfs(markdown_paths: list[Path]) -> None:
    for md_path in markdown_paths:
        render_markdown_pdf(md_path, md_path.with_suffix('.pdf'))
        print(f'Rendered {md_path.with_suffix(".pdf")}')


def generate_repeat_driver_report(week_folder: Path, render_pdf: bool) -> None:
    script = ROOT / 'scripts' / 'generate_repeat_driver_report.py'
    subprocess.run([
        sys.executable,
        str(script),
        str(week_folder),
        '--render-pdf',
        'true' if render_pdf else 'false',
    ], check=True)


def generate_monitor_report(week_folder: Path, render_pdf: bool, lookback: int, force: bool = True) -> None:
    script = ROOT / 'scripts' / 'generate_week_monitor.py'
    subprocess.run([
        sys.executable,
        str(script),
        str(week_folder),
        '--lookback',
        str(lookback),
        '--render-pdf',
        'true' if render_pdf else 'false',
        '--force',
        'true' if force else 'false',
    ], check=True, stdout=subprocess.DEVNULL)


def generate_pickup_evidence_report(week_folder: Path) -> None:
    script = ROOT / 'scripts' / 'fetch_pickup_evidence.mjs'
    subprocess.run([
        'node',
        str(script),
        '--week-folder',
        str(week_folder),
    ], check=True, cwd=ROOT)


def generate_business_closed_timing_report(week_folder: Path) -> None:
    script = ROOT / 'scripts' / 'fetch_business_closed_timing.mjs'
    result = subprocess.run([
        'node',
        str(script),
        '--week-folder',
        str(week_folder),
    ], check=False, cwd=ROOT)
    if result.returncode != 0:
        print('Business-closed timing refresh was incomplete; continuing with any timing rows already captured.', file=sys.stderr)


def main() -> int:
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    dry_run = parse_bool(args.get('dry-run'), False)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    include_repeat_driver = parse_bool(args.get('include-repeat-driver'), False)
    include_dispute_review = parse_bool(args.get('include-dispute-review'), True)
    include_monitor = parse_bool(args.get('include-monitor'), True)
    include_business_closed_timing = parse_bool(args.get('include-business-closed-timing'), True)
    include_pickup_evidence = parse_bool(args.get('include-pickup-evidence'), True)
    monitor_lookback = max(1, parse_int(args.get('monitor-lookback'), 4))
    max_dispute_candidates = max(1, parse_int(args.get('max-dispute-candidates'), DEFAULT_MAX_DISPUTE_CANDIDATES))
    max_dispute_review_candidates = max(1, parse_int(args.get('max-dispute-review-candidates'), MAX_DISPUTE_REVIEW_FILE_CANDIDATES))

    if dry_run:
        try:
            current, prior = load_week_context(week_folder)
        except FileNotFoundError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print('Dry run successful for', week_folder)
        print('Would write:', summary_markdown_path(week_folder, str(current['week_num'])))
        print('Would write:', disputes_markdown_path(week_folder, str(current['week_num'])))
        if include_dispute_review:
            print('Would write:', week_folder / 'dispute' / f"week{current['week_num']}-amazon-submission-review.md")
            print('Would write:', week_folder / 'dispute' / f"week{current['week_num']}-amazon-submission-review.json")
            print('Would write:', week_folder / 'dispute' / f"week{current['week_num']}-dcr-business-closed-evidence.csv")
            print('Would write:', week_folder / 'dispute' / f"week{current['week_num']}-evidence.md")
            print('Dispute candidate cap:', max_dispute_candidates)
            print('Dispute review candidate cap:', max_dispute_review_candidates)
        if include_monitor:
            monitor_stem = monitor_output_stem(week_folder, monitor_lookback)
            print('Would write:', week_folder / f'{monitor_stem}.md')
            if render_pdf:
                print('Would write:', week_folder / f'{monitor_stem}.pdf')
        if include_pickup_evidence:
            print('Would refresh:', week_folder / 'dispute' / f"week{current['week_num']}-pickup-evidence.csv")
            print('Would refresh:', week_folder / 'dispute' / f"week{current['week_num']}-pickup-evidence.md")
        if include_business_closed_timing:
            print('Would refresh:', week_folder / 'dispute' / f"week{current['week_num']}-business-closed-timing.csv")
        return 0

    if include_business_closed_timing:
        generate_business_closed_timing_report(week_folder)
    if include_pickup_evidence:
        generate_pickup_evidence_report(week_folder)

    # Load context after evidence refresh so reports use current portal timing and stop rows.
    try:
        current, prior = load_week_context(week_folder)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    summary_path = generate_summary_output(week_folder, current, prior, force=force, render_pdf=False)
    disputes_path = generate_disputes_output(week_folder, current, force=force, render_pdf=False, max_candidates=max_dispute_candidates)
    print(f'Wrote {summary_path}')
    print(f'Wrote {disputes_path}')
    extra_markdown_paths: list[Path] = []
    if include_dispute_review:
        review_paths = write_dispute_review_outputs(week_folder, current, force, max_dispute_review_candidates)
        for path in review_paths:
            print(f'Wrote {path}')
        extra_markdown_paths.extend(path for path in review_paths if path.suffix == '.md')

    if render_pdf:
        render_pdfs([summary_path, disputes_path, *extra_markdown_paths])

    if include_repeat_driver:
        generate_repeat_driver_report(week_folder, render_pdf)

    if include_monitor:
        generate_monitor_report(week_folder, render_pdf, monitor_lookback, True)
        monitor_stem = monitor_output_stem(week_folder, monitor_lookback)
        print(f'Wrote {week_folder / f"{monitor_stem}.md"}')
        if render_pdf:
            print(f'Rendered {week_folder / f"{monitor_stem}.pdf"}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
