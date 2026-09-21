"""Local development secret store.

Mirrors the production contract in platform/src/secrets: callers receive a
*reference*, never a value, and values are read only at the moment of use.

Layout (gitignored, owner-readable only):
    .openclaw/secrets/{tenant}/{integration}/{name}

Production resolves the same logical reference through AWS Secrets Manager.
Nothing here is ever written to the database, the API, logs, or git.
"""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_ROOT = ROOT / ".openclaw/secrets"

SLUG = re.compile(r"^[a-z][a-z0-9-]{2,62}$")
NAME = re.compile(r"^[a-z][a-z0-9-]{2,63}$")


def _validate(tenant: str, integration: str, name: str) -> None:
    if not SLUG.match(tenant or ""):
        raise ValueError("invalid tenant slug")
    if not NAME.match(integration or ""):
        raise ValueError("invalid integration name")
    if not NAME.match(name or ""):
        raise ValueError("invalid secret name")


def reference(tenant: str, integration: str, name: str) -> str:
    """Logical reference stored alongside the connection. Contains no value."""
    _validate(tenant, integration, name)
    return f"secret://{tenant}/aws-secrets/{integration}/{name}"


def _path(tenant: str, integration: str, name: str) -> Path:
    _validate(tenant, integration, name)
    return SECRET_ROOT / tenant / integration / name


def put_secret(tenant: str, integration: str, name: str, value: str) -> str:
    """Store a secret value and return only its reference."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("refusing to store an empty secret")
    path = _path(tenant, integration, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with owner-only permissions before any bytes are written.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(value.strip())
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return reference(tenant, integration, name)


def has_secret(tenant: str, integration: str, name: str) -> bool:
    return _path(tenant, integration, name).exists()


def get_secret(tenant: str, integration: str, name: str) -> str:
    """Read a value. Callers must not log, cache, or return it."""
    path = _path(tenant, integration, name)
    if not path.exists():
        raise KeyError(f"secret not configured: {reference(tenant, integration, name)}")
    return path.read_text().strip()


def describe(tenant: str, integration: str) -> list:
    """Metadata only: names, references, sizes. Never values."""
    directory = SECRET_ROOT / tenant / integration
    if not directory.exists():
        return []
    entries = []
    for item in sorted(directory.iterdir()):
        if item.is_file():
            entries.append({
                "name": item.name,
                "reference": reference(tenant, integration, item.name),
                "bytes": item.stat().st_size,
                "mode": oct(item.stat().st_mode & 0o777),
            })
    return entries


def delete_secret(tenant: str, integration: str, name: str) -> bool:
    path = _path(tenant, integration, name)
    if path.exists():
        path.unlink()
        return True
    return False
