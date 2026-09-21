"""Connection catalog + per-tenant state for the Connections screen.

Credential VALUES never live here. Each connection stores only a Secrets
Manager reference (secret://{tenant}/{provider}/{integration}/{name}) plus
health metadata, matching app.integration_connections in migration 004.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TENANT_ROOT = ROOT / "data/tenants"
SLUG = re.compile(r"^[a-z][a-z0-9-]{2,62}$")

# What a tenant can connect. auth_kind drives the UI affordance.
CATALOG = [
    {
        "id": "amazon_logistics", "displayName": "Amazon Logistics", "authKind": "browser_session",
        "category": "Amazon", "schedule": "Weekly scorecard + daily checks",
        "description": "Scorecards, driver performance, DVIC, capacity and reliability.",
        "feeds": ["Weekly Evaluation", "Driver Performance", "Fleet Compliance"],
        "reauthNote": "Amazon can revoke a saved session at any time. Reconnect takes about a minute and no credential is stored by the platform.",
    },
    {
        "id": "amazon_payments", "displayName": "Amazon Payments", "authKind": "browser_session",
        "category": "Amazon", "schedule": "Daily 05:00",
        "description": "Weekly invoices, fixed monthly fleet reconciliation, AFS entitlement.",
        "feeds": ["Reimbursement Review", "Fleet Costs"],
        "reauthNote": "Kept separate from the Logistics session so a health check cannot overwrite payment authorization.",
    },
    {
        "id": "email_imap", "displayName": "Report Email (IMAP)", "authKind": "imap_password",
        "category": "Unattended", "schedule": "Every 15 minutes",
        "description": "Fleet Condition Assessment, LSC cases, and Amazon notices delivered by email.",
        "feeds": ["Fleet Compliance", "Wear & Tear", "LSC cases"],
        "reauthNote": "An app password runs unattended and is the preferred path wherever Amazon emails the report.",
    },
    {
        "id": "adp", "displayName": "ADP Workforce", "authKind": "api_credentials",
        "category": "Unattended", "schedule": "Every 4 hours",
        "description": "Roster, timecards, payroll registers.",
        "feeds": ["Time & Attendance", "Payroll", "Workforce KPIs"],
        "reauthNote": "Certificate plus OAuth client credentials. Runs unattended once configured.",
    },
    {
        "id": "digits_api", "displayName": "Digits API", "authKind": "api_credentials",
        "category": "Unattended", "schedule": "Daily 06:00",
        "description": "Pulls fleet charges directly from Digits, replacing the monthly export upload.",
        "feeds": ["Fleet Costs"],
        "secretNames": ["client-id", "client-secret"],
        "reauthNote": "OAuth client credentials stored in managed secret storage. Runs unattended once configured; no browser session is involved.",
    },
    {
        "id": "financial_charges", "displayName": "Accounting export (fleet charges)", "authKind": "manual_upload",
        "category": "Manual upload", "schedule": "On upload",
        "description": "Rental, LMR, and lease charges you actually paid, compared against Amazon coverage.",
        "feeds": ["Fleet Costs"],
        "acceptedProviders": ["Digits", "QuickBooks", "CSV or spreadsheet"],
        "reauthNote": "Upload the export each period. The provider is detected automatically and no accounting credentials are shared with the platform.",
    },
    {
        "id": "fleet_portal", "displayName": "Amazon Fleet Portal / PAVE", "authKind": "browser_session",
        "category": "Amazon", "schedule": "Daily 04:00",
        "description": "Vehicle roster, ownership, registration, PM and inspection evidence.",
        "feeds": ["Fleet Compliance"],
        "reauthNote": "Shares the Amazon session strategy; reconnect when prompted.",
    },
]
BY_ID = {c["id"]: c for c in CATALOG}


# Upload sources accepted for financial charges, newest id first. The legacy
# "digits" id is still read so earlier uploads keep working.
FINANCIAL_SOURCES = ("financial_charges", "digits")

# Connections whose credentials live in managed secret storage. The registry
# reports only whether each required name is configured, never its value.
CREDENTIAL_SOURCES = ("digits_api",)


def _state_path(tenant: str) -> Path:
    if not SLUG.match(tenant or ""):
        raise ValueError("invalid tenant slug")
    return TENANT_ROOT / tenant / "connections.json"


def _read_state(tenant: str) -> dict:
    path = _state_path(tenant)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _write_state(tenant: str, state: dict) -> None:
    path = _state_path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2))


def secret_reference(tenant: str, connection_id: str, name: str) -> str:
    provider = "aws-secrets"
    integration = connection_id.replace("_", "-")
    return f"secret://{tenant}/{provider}/{integration}/{name}"


def set_connection_state(tenant: str, connection_id: str, **changes) -> dict:
    if connection_id not in BY_ID:
        raise KeyError(f"unknown connection: {connection_id}")
    state = _read_state(tenant)
    record = state.get(connection_id, {})
    record.update(changes)
    record["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    state[connection_id] = record
    _write_state(tenant, state)
    return record


def list_connections(tenant: str, upload_index=None) -> list:
    """Merge the catalog with stored per-tenant state and upload activity."""
    state = _read_state(tenant)
    uploads = upload_index or {}
    result = []
    for entry in CATALOG:
        stored = state.get(entry["id"], {})
        status = stored.get("status", "not_connected")
        last_success = stored.get("lastSuccessAt")

        if entry["authKind"] == "manual_upload":
            latest = uploads.get(entry["id"])
            if latest:
                status = "healthy"
                last_success = latest.get("confirmedAt") or latest.get("uploadedAt")

        result.append({
            **entry,
            "status": status,
            "configured": status != "not_connected",
            "secretReference": stored.get("secretReference"),
            "lastSuccessAt": last_success,
            "lastCheckedAt": stored.get("lastCheckedAt"),
            "lastError": stored.get("lastError"),
            "sessionExpiresAt": stored.get("sessionExpiresAt"),
            "reauthRequiredAt": stored.get("reauthRequiredAt"),
            "latestUpload": uploads.get(entry["id"]),
        })
    order = {"needs_reauth": 0, "degraded": 1, "not_connected": 2, "pending": 3, "healthy": 4, "disabled": 5}
    result.sort(key=lambda c: (order.get(c["status"], 9), c["displayName"]))
    return result
