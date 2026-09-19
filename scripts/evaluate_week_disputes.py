#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from evaluate_week import (
    MAX_DISPUTE_REVIEW_FILE_CANDIDATES,
    DEFAULT_MAX_DISPUTE_CANDIDATES,
    generate_disputes_output,
    load_week_context,
    parse_bool,
    parse_int,
    parse_args,
    disputes_markdown_path,
    render_pdfs,
    write_dispute_review_outputs,
)


def usage() -> None:
    print('Usage: evaluate_week_disputes.py <week-folder> [--force true|false] [--render-pdf true|false] [--dry-run true|false] [--include-dispute-review true|false] [--max-dispute-candidates N] [--max-dispute-review-candidates N]', file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1
    week_folder, args = parse_args(sys.argv)
    force = parse_bool(args.get('force'), False)
    render_pdf = parse_bool(args.get('render-pdf'), True)
    dry_run = parse_bool(args.get('dry-run'), False)
    include_dispute_review = parse_bool(args.get('include-dispute-review'), True)
    max_dispute_candidates = max(1, parse_int(args.get('max-dispute-candidates'), DEFAULT_MAX_DISPUTE_CANDIDATES))
    max_dispute_review_candidates = max(1, parse_int(args.get('max-dispute-review-candidates'), MAX_DISPUTE_REVIEW_FILE_CANDIDATES))

    try:
        current, _prior = load_week_context(Path(week_folder))
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    md_path = disputes_markdown_path(week_folder, str(current['week_num']))
    review_dir = week_folder / 'dispute'
    week_num = str(current['week_num'])
    if dry_run:
        print(f'Dry run successful for {week_folder}')
        print(f'Would write: {md_path}')
        if render_pdf:
            print(f'Would write: {md_path.with_suffix(".pdf")}')
        if include_dispute_review:
            print(f'Would write: {review_dir / f"week{week_num}-amazon-submission-review.md"}')
            print(f'Would write: {review_dir / f"week{week_num}-amazon-submission-review.json"}')
            print(f'Would write: {review_dir / f"week{week_num}-dcr-business-closed-evidence.csv"}')
            print(f'Would write: {review_dir / f"week{week_num}-evidence.md"}')
        return 0

    path = generate_disputes_output(
        week_folder,
        current,
        force=force,
        render_pdf=render_pdf,
        max_candidates=max_dispute_candidates,
    )
    print(f'Wrote {path}')
    if include_dispute_review:
        review_paths = write_dispute_review_outputs(week_folder, current, force, max_dispute_review_candidates)
        for review_path in review_paths:
            print(f'Wrote {review_path}')
        if render_pdf:
            render_pdfs([review_path for review_path in review_paths if review_path.suffix == '.md'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
