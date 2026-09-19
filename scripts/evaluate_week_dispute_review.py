#!/usr/bin/env python3
from __future__ import annotations

import sys

from evaluate_week import (
    MAX_DISPUTE_REVIEW_FILE_CANDIDATES,
    load_week_context,
    parse_bool,
    parse_int,
    parse_args,
    render_pdfs,
    write_dispute_review_outputs,
)


def usage() -> None:
    print('Usage: evaluate_week_dispute_review.py <week-folder> [--force true|false] [--render-pdf true|false] [--dry-run true|false] [--max-dispute-review-candidates N]', file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    dry_run = parse_bool(args.get('dry-run'), False)
    max_dispute_review_candidates = max(1, parse_int(args.get('max-dispute-review-candidates'), MAX_DISPUTE_REVIEW_FILE_CANDIDATES))

    try:
        current, _prior = load_week_context(week_folder)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    review_dir = week_folder / 'dispute'
    week_num = str(current['week_num'])
    if dry_run:
        print(f'Dry run successful for {week_folder}')
        print(f'Would write: {review_dir / f"week{week_num}-amazon-submission-review.md"}')
        print(f'Would write: {review_dir / f"week{week_num}-amazon-submission-review.json"}')
        print(f'Would write: {review_dir / f"week{week_num}-dcr-business-closed-evidence.csv"}')
        print(f'Would write: {review_dir / f"week{week_num}-evidence.md"}')
        return 0

    review_paths = write_dispute_review_outputs(week_folder, current, force, max_dispute_review_candidates)
    for path in review_paths:
        print(f'Wrote {path}')
    if render_pdf:
        render_pdfs([path for path in review_paths if path.suffix == '.md'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
