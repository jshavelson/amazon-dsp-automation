#!/usr/bin/env python3
from __future__ import annotations

import sys

from evaluate_week import (
    MAX_DISPUTE_REVIEW_FILE_CANDIDATES,
    build_dispute_review_entries,
    load_week_context,
    parse_bool,
    parse_int,
    parse_args,
    write_dispute_evidence_outputs,
)


def usage() -> None:
    print('Usage: evaluate_week_evidence.py <week-folder> [--force true|false] [--dry-run true|false] [--max-dispute-review-candidates N]', file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    dry_run = parse_bool(args.get('dry-run'), False)
    max_dispute_review_candidates = max(1, parse_int(args.get('max-dispute-review-candidates'), MAX_DISPUTE_REVIEW_FILE_CANDIDATES))

    try:
        current, _prior = load_week_context(week_folder)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    evidence_path = week_folder / 'dispute' / f"week{current['week_num']}-evidence.md"
    if dry_run:
        print(f'Dry run successful for {week_folder}')
        print(f'Would write: {evidence_path}')
        return 0

    entries = build_dispute_review_entries(current, max_dispute_review_candidates)
    for path in write_dispute_evidence_outputs(week_folder, current, entries):
        print(f'Wrote {path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
