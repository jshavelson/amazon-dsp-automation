#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
SOURCE="$ROOT/platform/web/"
DESTINATION="$ROOT/data/dashboards/platform/"

python3 "$ROOT/scripts/build_platform_module_status.py"
mkdir -p "$DESTINATION"
rsync -a --delete "$SOURCE" "$DESTINATION"
chmod 755 "$DESTINATION"
find "$DESTINATION" -type d -exec chmod 755 {} +
find "$DESTINATION" -type f -exec chmod 644 {} +

curl --fail --silent --show-error http://127.0.0.1:8765/platform/ >/dev/null
echo "Published private platform preview: https://oc-agents-mac-mini-1.tailee63c6.ts.net:8443/platform/"
