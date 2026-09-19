#!/usr/bin/env python3
from __future__ import annotations

import sys

from evaluate_week import (
    generate_monitor_report,
    monitor_output_stem,
    parse_bool,
    parse_int,
    parse_args,
)


def usage() -> None:
    print('Usage: evaluate_week_monitor.py <week-folder> [--lookback N] [--force true|false] [--render-pdf true|false] [--dry-run true|false]', file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    dry_run = parse_bool(args.get('dry-run'), False)
    lookback = max(1, parse_int(args.get('lookback'), 4))

    stem = monitor_output_stem(week_folder, lookback)
    md_path = week_folder / f'{stem}.md'
    if dry_run:
        print(f'Dry run successful for {week_folder}')
        print(f'Would write: {md_path}')
        if render_pdf:
            print(f'Would write: {md_path.with_suffix(".pdf")}')
        return 0

    generate_monitor_report(week_folder, render_pdf, lookback, force)
    print(f'Wrote {md_path}')
    if render_pdf:
        print(f'Rendered {md_path.with_suffix(".pdf")}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
