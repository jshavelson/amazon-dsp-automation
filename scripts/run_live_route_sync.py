#!/usr/bin/env python3
"""Poll Amazon Delivery Execution during operating hours without persisting credentials."""
import argparse
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
EASTERN = ZoneInfo("America/New_York")


def sync_once():
    return subprocess.run(["node", "scripts/amazon_live_routes.mjs"], cwd=ROOT, check=False).returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=300, help="seconds between pulls")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.once:
        raise SystemExit(sync_once())
    while True:
        now = datetime.now(EASTERN)
        if 5 <= now.hour < 23:
            sync_once()
        time.sleep(max(60, args.interval))


if __name__ == "__main__":
    main()
