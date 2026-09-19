#!/usr/bin/env python3
from __future__ import annotations

import csv
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / 'data' / 'scorecard_data'

TIER_RANK = {
    'poor': 0,
    'fair': 1,
    'great': 2,
    'fantastic': 3,
    'fantastic plus': 4,
}


def usage() -> None:
    print(
        'Usage: generate_week_monitor.py <week-number|YYYY-wkNN|week-folder> '
        '[--lookback N] [--render-pdf true|false] [--force true|false]',
        file=sys.stderr,
    )


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


def resolve_week_folder(target: str) -> Path:
    raw = target.strip().rstrip('/')
    candidate = Path(raw)
    if candidate.is_absolute() or '/' in raw:
        return candidate.resolve()
    if raw.lower().startswith('data/scorecard_data/'):
        return (ROOT / raw).resolve()
    if raw.lower().startswith('wk'):
        week_number = int(raw[2:])
        year = dt.date.today().year
        return (DATA_ROOT / f'{year}-wk{week_number:02d}').resolve()
    if raw.isdigit():
        week_number = int(raw)
        year = dt.date.today().year
        return (DATA_ROOT / f'{year}-wk{week_number:02d}').resolve()
    if len(raw) == 9 and raw[4:7].lower() == '-wk':
        return (DATA_ROOT / raw).resolve()
    raise ValueError(f'Could not resolve week target: {target}')


def infer_week_parts(week_folder: Path) -> tuple[int, int]:
    match = re.search(r'(\d{4})-wk(\d{1,2})$', week_folder.name)
    if not match:
        raise ValueError(f'Could not infer week from folder name: {week_folder.name}')
    return int(match.group(1)), int(match.group(2))


def week_folder_for(year: int, week_number: int) -> Path:
    return DATA_ROOT / f'{year}-wk{week_number:02d}'


def iter_week_folders(end_year: int, end_week: int, lookback: int) -> list[Path]:
    monday = dt.date.fromisocalendar(end_year, end_week, 1)
    folders: list[Path] = []
    for offset in range(lookback - 1, -1, -1):
        week_date = monday - dt.timedelta(days=offset * 7)
        year, week_number, _ = week_date.isocalendar()
        folders.append(week_folder_for(year, week_number))
    return folders


def find_one(week_folder: Path, pattern: str, *, exclude_preview: bool = False) -> Path | None:
    matches = sorted(
        path
        for path in week_folder.iterdir()
        if path.is_file() and pattern.lower() in path.name.lower()
    )
    if exclude_preview:
        matches = [path for path in matches if 'preview' not in path.name.lower()]
    return matches[0] if matches else None


def read_text(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def parse_summary_metrics(week_folder: Path, week_number: int) -> dict[str, str]:
    summary_path = week_folder / f'week{week_number:02d}-summary.md'
    if not summary_path.is_file():
        return {
            'dcr': 'n/a',
            'pod': 'n/a',
            'cdf_negative_feedback': 'n/a',
            'safety_events': 'n/a',
            'tenured_workforce': 'n/a',
        }

    rows: dict[str, str] = {}
    for line in read_text(summary_path).splitlines():
        if not line.startswith('|'):
            continue
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if len(cells) < 2:
            continue
        metric = cells[0]
        value = cells[1]
        rows[metric] = value

    return {
        'dcr': rows.get('DCR', 'n/a'),
        'pod': rows.get('POD', 'n/a'),
        'cdf_negative_feedback': rows.get('CDF negative feedback', 'n/a'),
        'safety_events': rows.get('Safety events', 'n/a'),
        'tenured_workforce': rows.get('Tenured workforce', 'n/a'),
    }


def parse_psb_rows(week_folder: Path) -> dict[str, object]:
    psb_path = find_one(week_folder, 'quality_psb')
    if psb_path is None:
        return {
            'pickup_stops': 'n/a',
            'failed_pickup_stops': 'n/a',
            'failed_drivers': [],
            'raw_read': 'PSB file missing',
        }

    success = 0
    failed = 0
    failed_drivers: list[str] = []
    with psb_path.open('r', encoding='utf-8-sig', newline='') as handle:
        for row in csv.DictReader(handle):
            row_success = int(float((row.get('Successful Stops') or '0').strip() or '0'))
            row_failed = int(float((row.get('Failed Stops') or '0').strip() or '0'))
            success += row_success
            failed += row_failed
            if row_failed:
                name = (row.get('Delivery Associate ') or '').strip()
                if name:
                    failed_drivers.append(name)

    return {
        'pickup_stops': success + failed,
        'failed_pickup_stops': failed,
        'failed_drivers': failed_drivers,
        'raw_read': f'raw file shows {success}/{success + failed} successful' if (success + failed) else 'raw file shows 0/0 successful',
    }


def extract_pdf_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    return '\n'.join(page.extract_text() or '' for page in reader.pages)


def extract_match(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text, flags=re.MULTILINE)
    if not match:
        return None
    return ' '.join(match.group(1).split())


def parse_scorecard_metrics(week_folder: Path) -> dict[str, str]:
    official_pdf = find_one(week_folder, '_en_dspscorecard', exclude_preview=True)
    preview_pdf = find_one(week_folder, 'dspscorecardpreview')
    pdf_path = official_pdf or preview_pdf
    if pdf_path is None:
        return {
            'overall_standing': 'Unavailable in frozen snapshot',
            'pickup_quality': 'PDF unavailable',
            'psb_metric': parse_psb_rows(week_folder)['raw_read'],
            'scorecard_source': 'missing',
        }

    text = extract_pdf_text(pdf_path)
    overall = extract_match(text, r'Overall Standing:\s*(.+)')
    pickup_quality = extract_match(text, r'Pickup Quality:\s*(.+)')
    psb = extract_match(text, r'i Pickup Success Behaviors\s+(.+)')

    if overall and '|' in overall:
        left, right = [part.strip() for part in overall.split('|', 1)]
        overall = f'{left}, {right}'
    if psb and '|' in psb:
        psb = psb.split('|', 1)[0].strip()

    return {
        'overall_standing': overall or 'Unavailable in scorecard text',
        'pickup_quality': pickup_quality or 'Unavailable in scorecard text',
        'psb_metric': psb or 'Unavailable in scorecard text',
        'scorecard_source': 'preview' if preview_pdf and pdf_path == preview_pdf else 'official',
    }


def extract_tier(overall_standing: str) -> str | None:
    lowered = overall_standing.lower()
    for tier in ('fantastic plus', 'fantastic', 'great', 'fair', 'poor'):
        if tier in lowered:
            return tier.title()
    return None


def tier_rank(tier: str | None) -> int | None:
    if tier is None:
        return None
    return TIER_RANK.get(tier.lower())


def format_week_label(year: int, week_number: int) -> str:
    return f'{year}-W{week_number:02d}'


def range_stem(weeks: list[dict[str, object]]) -> str:
    first = weeks[0]
    last = weeks[-1]
    if first['year'] == last['year']:
        return f"week{first['week_number']:02d}-week{last['week_number']:02d}-monitoring"
    return (
        f"{first['year']}wk{first['week_number']:02d}-"
        f"{last['year']}wk{last['week_number']:02d}-monitoring"
    )


def build_week_record(week_folder: Path) -> dict[str, object]:
    year, week_number = infer_week_parts(week_folder)
    summary_metrics = parse_summary_metrics(week_folder, week_number) if week_folder.is_dir() else {
        'dcr': 'n/a',
        'pod': 'n/a',
        'cdf_negative_feedback': 'n/a',
        'safety_events': 'n/a',
        'tenured_workforce': 'n/a',
    }
    psb_metrics = parse_psb_rows(week_folder) if week_folder.is_dir() else {
        'pickup_stops': 'n/a',
        'failed_pickup_stops': 'n/a',
        'failed_drivers': [],
        'raw_read': 'Week folder missing',
    }
    scorecard_metrics = parse_scorecard_metrics(week_folder) if week_folder.is_dir() else {
        'overall_standing': 'Week folder missing',
        'pickup_quality': 'Week folder missing',
        'psb_metric': 'Week folder missing',
        'scorecard_source': 'missing',
    }

    note: str
    if not week_folder.is_dir():
        note = 'Week folder missing from local snapshot.'
    elif scorecard_metrics['scorecard_source'] == 'official':
        if psb_metrics['failed_pickup_stops'] == 0:
            note = 'Official scorecard available; pickups were clean in the local PSB rows.'
        else:
            note = 'Official scorecard available; pickup misses were visible in the local PSB rows.'
    elif scorecard_metrics['scorecard_source'] == 'preview':
        note = 'Official scorecard missing; using preview PDF for tier tracking.'
    else:
        note = 'Official scorecard PDF is missing locally, but raw pickup rows are still available.'

    return {
        'year': year,
        'week_number': week_number,
        'week_label': format_week_label(year, week_number),
        'overall_standing': scorecard_metrics['overall_standing'],
        'pickup_quality': scorecard_metrics['pickup_quality'],
        'psb_metric': scorecard_metrics['psb_metric'],
        'pickup_stops': psb_metrics['pickup_stops'],
        'failed_pickup_stops': psb_metrics['failed_pickup_stops'],
        'failed_drivers': psb_metrics['failed_drivers'],
        'dcr': summary_metrics['dcr'],
        'pod': summary_metrics['pod'],
        'cdf_negative_feedback': summary_metrics['cdf_negative_feedback'],
        'safety_events': summary_metrics['safety_events'],
        'tenured_workforce': summary_metrics['tenured_workforce'],
        'scorecard_source': scorecard_metrics['scorecard_source'],
        'note': note,
        'tier': extract_tier(str(scorecard_metrics['overall_standing'])),
    }


def build_trend_lines(records: list[dict[str, object]]) -> list[str]:
    lines: list[str] = []
    latest = records[-1]
    latest_tier = latest['tier']
    latest_failed = latest['failed_pickup_stops']
    available_tiers = [record for record in records if record['tier']]

    if latest_tier:
        lines.append(
            f"- Latest week `{latest['week_label']}` held **{latest_tier}** with pickup quality "
            f"at **{latest['pickup_quality']}**."
        )

    if available_tiers:
        strongest = max(available_tiers, key=lambda record: tier_rank(record['tier']) or -1)
        lines.append(
            f"- Best available scorecard tier in this window was **{strongest['tier']}** in "
            f"`{strongest['week_label']}`."
        )

    stronger_prior = [
        record for record in records[:-1]
        if tier_rank(record['tier']) is not None and tier_rank(record['tier']) > (tier_rank(latest_tier) or -1)
    ]
    if stronger_prior:
        prior_labels = ', '.join(f"`{record['week_label']}`" for record in stronger_prior)
        lines.append(
            f"- The latest week sits below a stronger recent tier seen in {prior_labels}, so watch for a slide "
            f"from `Fantastic Plus` to `Fantastic` becoming permanent."
        )

    pickup_risk_weeks = [record for record in records if isinstance(record['failed_pickup_stops'], int) and record['failed_pickup_stops'] >= 2]
    if pickup_risk_weeks:
        labels = ', '.join(
            f"`{record['week_label']}` ({record['failed_pickup_stops']} failed stops)"
            for record in pickup_risk_weeks
        )
        lines.append(f"- Pickup risk crossed the `2+` failed-stop line in {labels}.")
    elif isinstance(latest_failed, int):
        lines.append(
            f"- Pickup misses stayed below the `2+` failed-stop risk line in every included week; latest week had "
            f"`{latest_failed}` failed stops."
        )

    pickup_failers = [
        record for record in records
        if isinstance(record['failed_pickup_stops'], int) and record['failed_pickup_stops'] > 0
    ]
    if pickup_failers:
        lines.append(
            f"- Pickup defects showed up in **{len(pickup_failers)} of {len(records)}** weeks in the window."
        )

    return lines


def build_markdown(records: list[dict[str, object]]) -> str:
    title = f"Weeks {records[0]['week_number']:02d}-{records[-1]['week_number']:02d} Monitoring"
    focus = 'Overall standing stability, pickup exposure, and the small set of metrics most likely to push the DSP out of `Fantastic`'

    scoreboard_lines = [
        '| Week | Overall standing | Pickup quality | PSB metric | Pickup stops | Failed pickup stops | DCR | POD | CDF negative feedback | Safety events | Tenured workforce | Read |',
        '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|',
    ]
    for record in records:
        scoreboard_lines.append(
            f"| {record['week_label']} | `{record['overall_standing']}` | `{record['pickup_quality']}` | "
            f"{record['psb_metric']} | {record['pickup_stops']} | {record['failed_pickup_stops']} | "
            f"{record['dcr']} | {record['pod']} | {record['cdf_negative_feedback']} | {record['safety_events']} | "
            f"{record['tenured_workforce']} | {record['note']} |"
        )

    pickup_watch_lines = []
    for record in records:
        failed_drivers = ', '.join(f'`{name}`' for name in record['failed_drivers']) or 'none'
        pickup_watch_lines.append(
            f"- `{record['week_label']}`: {record['pickup_stops']} pickup stops, "
            f"{record['failed_pickup_stops']} failed. Failed drivers: {failed_drivers}."
        )

    source_note_lines = []
    for record in records:
        source = record['scorecard_source']
        if source == 'official':
            source_note_lines.append(f"- `{record['week_label']}`: official DSP scorecard PDF available locally.")
        elif source == 'preview':
            source_note_lines.append(f"- `{record['week_label']}`: official PDF missing; using local preview PDF.")
        else:
            source_note_lines.append(f"- `{record['week_label']}`: no local scorecard PDF or preview PDF available.")

    trend_lines = build_trend_lines(records)

    return (
        f"# {title}\n\n"
        f"**DSP:** JECS  \n"
        f"**Station:** DFH7  \n"
        f"**Focus:** {focus}\n\n"
        f"## Weekly scoreboard\n"
        f"{chr(10).join(scoreboard_lines)}\n\n"
        f"## Pickup watch\n"
        f"{chr(10).join(pickup_watch_lines)}\n\n"
        f"## Trend read\n"
        f"{chr(10).join(trend_lines)}\n\n"
        f"## Monitor every week\n"
        f"- Overall standing and numeric score from the official DSP scorecard PDF.\n"
        f"- Pickup stops, failed pickup stops, and failed-driver names from `Quality_PSB`.\n"
        f"- DCR and POD from the weekly summary.\n"
        f"- CDF negative feedback count and top complaint drivers.\n"
        f"- Safety event count.\n"
        f"- Tenured workforce rate.\n\n"
        f"## Immediate watch thresholds\n"
        f"- Any week with `2+` failed pickup stops on low pickup volume should be treated as a scorecard-risk week.\n"
        f"- Any combination of weaker pickup quality plus softening DCR should be treated as a risk of falling out of `Fantastic`.\n"
        f"- If the official scorecard PDF is missing from a frozen snapshot, treat the week as incomplete for tier-tracking until the source file is recovered.\n\n"
        f"## Source notes\n"
        f"{chr(10).join(source_note_lines)}\n"
    )


def render_markdown_pdf(md_path: Path, pdf_path: Path) -> None:
    renderer = ROOT / 'scripts' / 'render_markdown_to_pdf.py'
    subprocess.run([sys.executable, str(renderer), str(md_path), str(pdf_path)], check=True, stdout=subprocess.DEVNULL)


def main() -> int:
    target, args = parse_args(sys.argv)
    end_week_folder = resolve_week_folder(target)
    end_year, end_week = infer_week_parts(end_week_folder)
    lookback = max(1, parse_int(args.get('lookback'), 4))
    render_pdf = parse_bool(args.get('render-pdf'), False)
    force = parse_bool(args.get('force'), False)

    week_folders = iter_week_folders(end_year, end_week, lookback)
    records = [build_week_record(folder) for folder in week_folders]
    output_stem = range_stem(records)
    md_path = end_week_folder / f'{output_stem}.md'
    pdf_path = md_path.with_suffix('.pdf')

    if not end_week_folder.is_dir():
        print(f'Week folder not found: {end_week_folder}', file=sys.stderr)
        return 1

    if not force:
        existing = [str(path) for path in (md_path, pdf_path) if path.exists()]
        if existing:
            raise FileExistsError(f'Refusing to overwrite existing outputs without --force true: {", ".join(existing)}')

    markdown = build_markdown(records)
    md_path.write_text(markdown, encoding='utf-8')
    print(f'Wrote {md_path}')

    if render_pdf:
        render_markdown_pdf(md_path, pdf_path)
        print(f'Rendered {pdf_path}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
