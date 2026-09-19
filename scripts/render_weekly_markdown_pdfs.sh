#!/bin/zsh
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <week-folder>" >&2
  exit 1
fi

week_dir="$1"
if [[ ! -d "$week_dir" ]]; then
  echo "Folder not found: $week_dir" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
renderer="$script_dir/render_markdown_to_pdf.py"

if [[ ! -f "$renderer" ]]; then
  echo "Renderer not found: $renderer" >&2
  exit 1
fi

typeset -a files
for md in "$week_dir"/week*.md "$week_dir"/dispute/*.md; do
  [[ -f "$md" ]] && files+=("$md")
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No markdown deliverables found in $week_dir" >&2
  exit 1
fi

for md in "${files[@]}"; do
  pdf="${md%.md}.pdf"
  python3 "$renderer" "$md" "$pdf"
done
