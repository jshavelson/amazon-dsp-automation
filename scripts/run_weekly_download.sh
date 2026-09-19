#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <week-folder> [extra amazon:download args...]" >&2
  exit 1
fi

week_dir="$1"
shift

cd "$(dirname "$0")/.."
npm run amazon:download -- --week-folder "$week_dir" "$@"
