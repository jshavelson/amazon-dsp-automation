#!/usr/bin/env python3
"""Non-secret production readiness check for the multi-tenant platform."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import ssl
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "AUTH_CLIENT_ID",
    "AUTHORIZATION_URL", "TOKEN_URL", "TENANT_SLUG",
)
PLACEHOLDER = re.compile(r"replace|example\.com|identity\.example|change.?me", re.I)


def check(environment: dict[str, str], online: bool = False) -> dict:
    checks = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "status": "pass" if ok else "blocked", "detail": detail})

    for name in REQUIRED:
        value = environment.get(name, "")
        add(f"config:{name}", bool(value and not PLACEHOLDER.search(value)), "configured" if value and not PLACEHOLDER.search(value) else "missing or placeholder")

    database = environment.get("DATABASE_URL", "")
    parsed_db = urlparse(database) if database else None
    split_database = all(environment.get(name) for name in ("DB_HOST", "DB_USER", "DB_PASSWORD"))
    tls_database_url = bool(parsed_db and "sslmode=require" in parsed_db.query)
    add("database:configuration", tls_database_url or split_database, "TLS URL or split runtime fields configured" if tls_database_url or split_database else "DATABASE_URL with sslmode=require or DB_HOST/DB_USER/DB_PASSWORD required")

    for name in ("OIDC_ISSUER", "OIDC_JWKS_URL", "AUTHORIZATION_URL", "TOKEN_URL"):
        value = environment.get(name, "")
        add(f"identity:{name}:https", value.startswith("https://"), "HTTPS" if value.startswith("https://") else "HTTPS URL required")

    add("container:docker", shutil.which("docker") is not None, shutil.which("docker") or "docker not installed")
    add("deployment:dockerfile", (ROOT / "platform/Dockerfile").exists(), "present")
    add("deployment:compose", (ROOT / "platform/compose.yaml").exists(), "present")
    add("database:migrations", len(list((ROOT / "platform/db/migrations").glob("*.sql"))) >= 3, "three migration sets present")
    add("secrets:no_populated_env", not (ROOT / "platform/.env.production").exists(), "no populated production dotenv in repository")

    if online and environment.get("OIDC_JWKS_URL") and not PLACEHOLDER.search(environment["OIDC_JWKS_URL"]):
        try:
            request = urllib.request.Request(environment["OIDC_JWKS_URL"], headers={"User-Agent": "dsp-platform-preflight/1"})
            with urllib.request.urlopen(request, timeout=10, context=ssl.create_default_context()) as response:
                payload = json.loads(response.read())
            add("identity:jwks_reachable", response.status == 200 and isinstance(payload.get("keys"), list), "JWKS loaded")
        except Exception as exc:
            add("identity:jwks_reachable", False, f"unreachable: {type(exc).__name__}")

    blocked = [item for item in checks if item["status"] == "blocked"]
    return {"ready": not blocked, "checks": checks, "blocked_count": len(blocked)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = check(dict(os.environ), args.online)
    print(json.dumps(result, indent=2) if args.json else "\n".join(f"[{x['status'].upper()}] {x['name']}: {x['detail']}" for x in result["checks"]))
    return 0 if result["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
