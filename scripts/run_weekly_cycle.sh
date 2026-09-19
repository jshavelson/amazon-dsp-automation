#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <week-folder> [download-args...]" >&2
  exit 1
fi

week_dir="$1"
shift

cd "$(dirname "$0")/.."

npm run amazon:download -- --week-folder "$week_dir" "$@"
python3 scripts/evaluate_week.py "$week_dir" --force true --render-pdf true --include-repeat-driver true
