#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / 'data' / 'scorecard_data' / '_templates'

SUMMARY_TEMPLATE = TEMPLATE_DIR / 'week-summary-template.md'
DISPUTES_TEMPLATE = TEMPLATE_DIR / 'week-disputes-template.md'


def usage() -> None:
    print('Usage: init_weekly_report_templates.py <week-folder> [DSP] [STATION]', file=sys.stderr)
    print('Example: init_weekly_report_templates.py data/scorecard_data/2026-wk18 JECS DFH7', file=sys.stderr)


def infer_week_parts(week_folder: pathlib.Path) -> tuple[str, str]:
    m = re.search(r'(\d{4})-wk(\d{1,2})$', week_folder.name)
    if not m:
        raise ValueError(f'Could not infer year/week from folder name: {week_folder.name}')
    year = m.group(1)
    week_num = int(m.group(2))
    return f'{year}-W{week_num:02d}', f'{week_num:02d}'


def apply_common_placeholders(text: str, week_label: str, week_number: str, dsp: str, station: str) -> str:
    today = dt.date.today().isoformat()
    replacements = {
        '{{WEEK_LABEL}}': week_label,
        '{{WEEK_NUMBER}}': week_number,
        '{{DSP}}': dsp,
        '{{STATION}}': station,
        '{{PREPARED_DATE}}': today,
        '{{CURRENT_WEEK_LABEL}}': f'Week {week_number}',
        '{{PRIOR_WEEK_LABEL}}': f'Week {max(1, int(week_number)-1):02d}',
        '{{PRIOR_CAPACITY_RELIABILITY}}': 'n/a',
        '{{CAPACITY_RELIABILITY}}': '100%',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def main() -> int:
    if len(sys.argv) < 2 or len(sys.argv) > 4:
        usage()
        return 1

    week_folder = pathlib.Path(sys.argv[1]).resolve()
    dsp = sys.argv[2] if len(sys.argv) >= 3 else 'JECS'
    station = sys.argv[3] if len(sys.argv) >= 4 else 'DFH7'

    if not week_folder.exists() or not week_folder.is_dir():
        print(f'Week folder not found: {week_folder}', file=sys.stderr)
        return 1

    if not SUMMARY_TEMPLATE.exists() or not DISPUTES_TEMPLATE.exists():
        print('Template files are missing.', file=sys.stderr)
        return 1

    week_label, week_number = infer_week_parts(week_folder)
    summary_out = week_folder / f'week{week_number}-summary.md'
    disputes_out = week_folder / f'week{week_number}-disputes.md'

    if summary_out.exists() or disputes_out.exists():
        print('Refusing to overwrite existing weekly deliverables.', file=sys.stderr)
        print(f'Existing: {summary_out if summary_out.exists() else ""} {disputes_out if disputes_out.exists() else ""}'.strip(), file=sys.stderr)
        return 1

    summary_text = apply_common_placeholders(SUMMARY_TEMPLATE.read_text(encoding='utf-8'), week_label, week_number, dsp, station)
    disputes_text = apply_common_placeholders(DISPUTES_TEMPLATE.read_text(encoding='utf-8'), week_label, week_number, dsp, station)

    summary_out.write_text(summary_text, encoding='utf-8')
    disputes_out.write_text(disputes_text, encoding='utf-8')

    print(f'Created {summary_out}')
    print(f'Created {disputes_out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
