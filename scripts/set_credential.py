#!/usr/bin/env python3
"""Store an integration credential without it passing through chat or shell history.

The value is read from a hidden prompt (or stdin when piped), written straight
to the local secret store with owner-only permissions, and never echoed.

    python3 scripts/set_credential.py --integration digits --name client-secret
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.secret_store import describe, has_secret, put_secret, reference  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", default="jecs")
    parser.add_argument("--integration", required=True)
    parser.add_argument("--name", help="secret name (required unless --list)")
    parser.add_argument("--list", action="store_true", help="show configured names only")
    args = parser.parse_args()

    if not args.list and not args.name:
        parser.error("--name is required unless --list is used")

    if args.list:
        for entry in describe(args.tenant, args.integration):
            print(f"  {entry['name']:<18} {entry['reference']}  ({entry['bytes']} bytes, mode {entry['mode']})")
        return 0

    if sys.stdin.isatty():
        value = getpass.getpass(f"Paste value for {args.integration}/{args.name} (hidden): ")
        confirm = getpass.getpass("Re-enter to confirm: ")
        if value != confirm:
            print("Values did not match. Nothing was stored.", file=sys.stderr)
            return 1
    else:
        value = sys.stdin.read()

    if not value.strip():
        print("Empty value. Nothing was stored.", file=sys.stderr)
        return 1

    was_set = has_secret(args.tenant, args.integration, args.name)
    ref = put_secret(args.tenant, args.integration, args.name, value)
    print(("Replaced " if was_set else "Stored ") + ref)
    print(f"  length: {len(value.strip())} characters (value not displayed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
