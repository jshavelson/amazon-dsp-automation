"""Tenant-scoped file storage for uploaded source data.

Local layout mirrors the production S3 layout exactly:

    local:      data/tenants/{tenant}/uploads/{source}/{sha12}-{filename}
    production: s3://{bucket}/tenants/{tenant}/{source}/{sha12}-{filename}

Only this module knows where bytes live, so swapping in S3 is one class.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TENANT_ROOT = ROOT / "data/tenants"
SLUG = re.compile(r"^[a-z][a-z0-9-]{2,62}$")
SOURCE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


def _validate(tenant: str, source: str) -> None:
    if not SLUG.match(tenant or ""):
        raise ValueError("invalid tenant slug")
    if not SOURCE.match(source or ""):
        raise ValueError("invalid source")


def _index_path(tenant: str) -> Path:
    return TENANT_ROOT / tenant / "uploads" / "index.json"


def _read_index(tenant: str) -> list:
    path = _index_path(tenant)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


def _write_index(tenant: str, records: list) -> None:
    path = _index_path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2))


def storage_key(tenant: str, source: str, digest: str, filename: str) -> str:
    """Canonical object key, identical in local storage and S3."""
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[-120:]
    return f"tenants/{tenant}/{source}/{digest[:12]}-{safe}"


def _local_path(storage_key_value: str) -> Path:
    """Map the canonical key onto local disk.

    TENANT_ROOT already ends in "tenants", so the key's leading segment is
    stripped to avoid a data/tenants/tenants/... path.
    """
    relative = storage_key_value.split("/", 1)[1] if storage_key_value.startswith("tenants/") else storage_key_value
    return TENANT_ROOT / relative


def put_file(tenant: str, source: str, filename: str, payload: bytes, uploaded_by: str) -> dict:
    """Store bytes and return the metadata row. Re-uploading identical bytes is idempotent."""
    _validate(tenant, source)
    if not payload:
        raise ValueError("empty upload")
    digest = hashlib.sha256(payload).hexdigest()
    records = _read_index(tenant)
    for record in records:
        if record["source"] == source and record["contentSha256"] == digest and record["status"] != "rejected":
            return record

    key = storage_key(tenant, source, digest, filename)
    destination = _local_path(key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    destination.chmod(0o600)

    record = {
        "id": digest[:16],
        "tenant": tenant,
        "source": source,
        "originalFilename": filename,
        "storageKey": key,
        "contentSha256": digest,
        "byteSize": len(payload),
        "status": "uploaded",
        "parseSummary": {},
        "uploadedBy": uploaded_by,
        "uploadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "confirmedAt": None,
        "periodKey": None,
    }
    records.append(record)
    _write_index(tenant, records)
    return record


def update_file(tenant: str, file_id: str, **changes) -> dict:
    records = _read_index(tenant)
    for record in records:
        if record["id"] == file_id:
            record.update(changes)
            _write_index(tenant, records)
            return record
    raise KeyError(f"unknown upload: {file_id}")


def supersede_others(tenant: str, source: str, keep_id: str, period_key: str | None) -> int:
    """A confirmed upload replaces earlier confirmed uploads for the same period."""
    records = _read_index(tenant)
    count = 0
    for record in records:
        if (record["source"] == source and record["id"] != keep_id
                and record["status"] == "confirmed"
                and (period_key is None or record.get("periodKey") == period_key)):
            record["status"] = "superseded"
            count += 1
    if count:
        _write_index(tenant, records)
    return count


def list_files(tenant: str, source: str | None = None) -> list:
    records = _read_index(tenant)
    if source:
        records = [r for r in records if r["source"] == source]
    return sorted(records, key=lambda r: r["uploadedAt"], reverse=True)


def get_file(tenant: str, file_id: str) -> dict | None:
    return next((r for r in _read_index(tenant) if r["id"] == file_id), None)


def read_bytes(tenant: str, file_id: str) -> bytes:
    record = get_file(tenant, file_id)
    if not record:
        raise KeyError(f"unknown upload: {file_id}")
    return _local_path(record["storageKey"]).read_bytes()


def latest_confirmed(tenant: str, source: str) -> dict | None:
    return next((r for r in list_files(tenant, source) if r["status"] == "confirmed"), None)
