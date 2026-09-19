#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / 'data' / 'scorecard_data'
RUN_STATUS = 'run-status.json'
CORE_PATTERNS = [
    'DSP_Overview_Dashboard',
    'Quality_DCR',
    'Quality_DSB_DNR',
    'Quality_POD',
    'Quality_CDF',
    'Quality_RTS',
    'DSP_Customer_Delivery_Feedback_negative',
    'DSP_Delivery_Concessions',
]


def usage() -> None:
    print('Usage: evaluate_week_request.py <week-number|YYYY-wkNN|week-folder> [--year YYYY] [--refresh-source true|false] [--max-dispute-candidates N] [--max-dispute-review-candidates N] [--render-pdf true|false] [--include-repeat-driver true|false] [--include-dispute-review true|false] [--include-monitor true|false] [--include-business-closed-timing true|false] [--include-pickup-evidence true|false] [--monitor-lookback N]', file=sys.stderr)


def parse_args(argv: list[str]) -> tuple[str, dict[str, str | bool]]:
    if len(argv) < 2:
        usage()
        raise SystemExit(1)
    target = argv[1]
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
    return target, args


def parse_bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() == 'true'


def parse_int(value: str | bool | None, default: int) -> int:
    if value is None or isinstance(value, bool):
        return default
    try:
        return int(str(value).strip())
    except ValueError:
        return default


def resolve_week_folder(target: str, args: dict[str, str | bool]) -> Path:
    raw = target.strip()
    if raw.endswith('/'):
        raw = raw[:-1]
    candidate = Path(raw)
    if candidate.is_absolute() or '/' in raw:
        return candidate.resolve()
    if raw.lower().startswith('data/scorecard_data/'):
        return (ROOT / raw).resolve()
    if raw.lower().startswith('wk'):
        week_number = int(raw[2:])
        year = parse_int(args.get('year'), dt.date.today().year)
        return (DATA_ROOT / f'{year}-wk{week_number:02d}').resolve()
    if raw.isdigit():
        week_number = int(raw)
        year = parse_int(args.get('year'), dt.date.today().year)
        return (DATA_ROOT / f'{year}-wk{week_number:02d}').resolve()
    if len(raw) == 9 and raw[4:7].lower() == '-wk':
        return (DATA_ROOT / raw).resolve()
    raise ValueError(f'Could not resolve week target: {target}')


def list_files(folder: Path) -> list[str]:
    if not folder.is_dir():
        return []
    return sorted(path.name for path in folder.iterdir() if path.is_file())


def has_core_exports(folder: Path) -> bool:
    files = list_files(folder)
    return all(any(pattern in name for name in files) for pattern in CORE_PATTERNS)


def run_status_incomplete(folder: Path) -> bool:
    status_path = folder / RUN_STATUS
    if not status_path.is_file():
        return False
    try:
        data = json.loads(status_path.read_text(encoding='utf-8'))
    except Exception:
        return True
    if not isinstance(data, dict):
        return True
    if data.get('status') in {'failed', 'incomplete'}:
        return True
    if data.get('missingRequired'):
        return True
    return False


def choose_download_mode(folder: Path, refresh_source: bool) -> tuple[str, list[str]]:
    if not folder.exists():
        return 'full-download', ['--allow-missing', 'true']
    if not has_core_exports(folder):
        return 'full-download', ['--allow-missing', 'true']
    if not refresh_source:
        return 'analyze-only', []
    if not run_status_incomplete(folder):
        return 'analyze-only', []
    return 'supplementary-refresh', ['--supplementary-only', 'true', '--allow-missing', 'true']


def run_command(args: list[str]) -> None:
    subprocess.run(args, check=True, cwd=ROOT)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def previous_week_folder(week_folder: Path) -> Path | None:
    name = week_folder.name
    if len(name) != 9 or name[4:7].lower() != '-wk':
        return None
    try:
        year = int(name[:4])
        week = int(name[7:])
        previous = dt.date.fromisocalendar(year, week, 1) - dt.timedelta(days=7)
    except (ValueError, TypeError):
        return None
    previous_year, previous_week, _ = previous.isocalendar()
    return DATA_ROOT / f'{previous_year}-wk{previous_week:02d}'


def has_file_pattern(folder: Path, pattern: str) -> bool:
    return any(pattern in name for name in list_files(folder))


def backfill_previous_capacity_report(week_folder: Path, render_pdf: bool) -> None:
    if has_file_pattern(week_folder, 'Capacity-Reliability'):
        return
    previous_folder = previous_week_folder(week_folder)
    if previous_folder is None or not previous_folder.is_dir():
        print('Current Capacity Reliability report is unavailable; no previous week folder exists to backfill.')
        return

    print(f'Current Capacity Reliability report is unavailable; checking {display_path(previous_folder)}.')
    if not has_file_pattern(previous_folder, 'Capacity-Reliability'):
        run_command([
            'npm', 'run', 'amazon:download', '--',
            '--week-folder', display_path(previous_folder),
            '--supplementary-only', 'true',
            '--allow-missing', 'true',
        ])

    if not has_file_pattern(previous_folder, 'Capacity-Reliability'):
        print(f'Previous week Capacity Reliability report is still unavailable from Amazon: {display_path(previous_folder)}')
        return

    print(f'Refreshing previous week summary and disputes with Capacity Reliability: {display_path(previous_folder)}')
    common_args = [
        str(previous_folder),
        '--force', 'true',
        '--render-pdf', 'true' if render_pdf else 'false',
    ]
    run_command([sys.executable, str(ROOT / 'scripts' / 'evaluate_week_summary.py'), *common_args])
    run_command([sys.executable, str(ROOT / 'scripts' / 'evaluate_week_disputes.py'), *common_args])


def main() -> int:
    target, args = parse_args(sys.argv)
    week_folder = resolve_week_folder(target, args)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    include_repeat_driver = parse_bool(args.get('include-repeat-driver'), False)
    include_dispute_review = parse_bool(args.get('include-dispute-review'), True)
    include_monitor = parse_bool(args.get('include-monitor'), True)
    include_business_closed_timing = parse_bool(args.get('include-business-closed-timing'), True)
    include_pickup_evidence = parse_bool(args.get('include-pickup-evidence'), True)
    monitor_lookback = max(1, parse_int(args.get('monitor-lookback'), 4))
    refresh_source = parse_bool(args.get('refresh-source'), False)
    max_dispute_candidates = max(1, parse_int(args.get('max-dispute-candidates'), 3))
    max_review_candidates = max(1, parse_int(args.get('max-dispute-review-candidates'), 3))

    week_folder.mkdir(parents=True, exist_ok=True)
    mode, download_args = choose_download_mode(week_folder, refresh_source)
    print(f'Evaluate mode: {mode}')
    if mode != 'analyze-only':
        run_command([
            'npm', 'run', 'amazon:download', '--',
            '--week-folder', display_path(week_folder),
            *download_args,
        ])

    backfill_previous_capacity_report(week_folder, render_pdf)

    run_command([
        sys.executable,
        str(ROOT / 'scripts' / 'evaluate_week.py'),
        str(week_folder),
        '--force', 'true',
        '--render-pdf', 'true' if render_pdf else 'false',
        '--include-repeat-driver', 'true' if include_repeat_driver else 'false',
        '--include-dispute-review', 'true' if include_dispute_review else 'false',
        '--include-monitor', 'true' if include_monitor else 'false',
        '--include-business-closed-timing', 'true' if include_business_closed_timing else 'false',
        '--include-pickup-evidence', 'true' if include_pickup_evidence else 'false',
        '--monitor-lookback', str(monitor_lookback),
        '--max-dispute-candidates', str(max_dispute_candidates),
        '--max-dispute-review-candidates', str(max_review_candidates),
    ])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
