#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from evaluate_week import (
    generate_summary_output,
    load_week_context,
    parse_bool,
    parse_args,
    summary_markdown_path,
)


def usage() -> None:
    print('Usage: evaluate_week_summary.py <week-folder> [--force true|false] [--render-pdf true|false] [--dry-run true|false]', file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    dry_run = parse_bool(args.get('dry-run'), False)

    try:
        current, prior = load_week_context(Path(week_folder))
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    md_path = summary_markdown_path(week_folder, str(current['week_num']))
    if dry_run:
        print(f'Dry run successful for {week_folder}')
        print(f'Would write: {md_path}')
        if render_pdf:
            print(f'Would write: {md_path.with_suffix(".pdf")}')
        return 0

    path = generate_summary_output(week_folder, current, prior, force=force, render_pdf=render_pdf)
    print(f'Wrote {path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
