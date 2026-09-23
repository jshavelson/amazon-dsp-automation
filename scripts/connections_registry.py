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
import os
import threading

from scripts.secret_store import has_secret

ROOT = Path(__file__).resolve().parents[1]
TENANT_ROOT = ROOT / "data/tenants"
SLUG = re.compile(r"^[a-z][a-z0-9-]{2,62}$")
PAVE_LOGIN_URL = "https://dashboard.paveapi.com/login"
_STATE_LOCK = threading.RLock()

# What a tenant can connect. auth_kind drives the UI affordance.
CATALOG = [
    {
        "id": "amazon", "displayName": "Amazon DSP", "authKind": "browser_session",
        "category": "Amazon", "schedule": "Daily checks + weekly reports",
        "description": "One Amazon sign-in for scorecards, Cortex Fleet Dashboard readiness, Cortex Payments coverage, Supplemental FCA reports, routes, disputes and reimbursements.",
        "feeds": ["Weekly Evaluation", "Driver Performance", "Routes", "Disputes", "Fleet Compliance", "Fleet Costs"],
        "reauthNote": "Amazon may revoke the shared session. Complete MFA once to restore all Amazon-backed feeds.",
        "reconnectLabel": "Amazon",
    },
    {
        "id": "pave", "displayName": "PAVE", "authKind": "browser_session",
        "category": "Fleet", "schedule": "Daily 04:00",
        "description": "Separate PAVE website connection for vehicle assessments, inspection evidence and wear-and-tear results.",
        "feeds": ["Vans", "Fleet Compliance", "Wear & Tear"],
        "reauthNote": "PAVE authentication is separate from Amazon. Reconnect when PAVE revokes the saved browser session.",
        "reconnectLabel": "PAVE",
        "credentialFields": [],
        "environments": ["production"],
        "testable": False,
    },
    {
        "id": "email_imap", "displayName": "Report Email (IMAP)", "authKind": "imap_password",
        "category": "Unattended", "schedule": "Every 15 minutes",
        "description": "Scans FCA notices and LSC case correspondence to corroborate Cortex Supplemental Reports and PAVE.",
        "feeds": ["Fleet Compliance", "Wear & Tear", "LSC cases"],
        "reauthNote": "An app password runs unattended and is the preferred path wherever Amazon emails the report.",
        "credentialFields": [
            {"name": "host", "label": "IMAP host", "secret": False, "placeholder": "imap.example.com"},
            {"name": "port", "label": "IMAP port", "secret": False, "placeholder": "993"},
            {"name": "username", "label": "Mailbox username", "secret": False, "placeholder": "reports@company.com"},
            {"name": "appPassword", "label": "App password", "secret": True, "placeholder": "Mailbox app password"},
        ],
        "environments": ["production"],
        "testable": True,
    },
    {
        "id": "adp", "displayName": "ADP Workforce", "authKind": "api_credentials",
        "category": "Unattended", "schedule": "Every 4 hours",
        "description": "Roster, timecards, payroll registers.",
        "feeds": ["Time & Attendance", "Payroll", "Workforce KPIs"],
        "reauthNote": "Certificate plus OAuth client credentials. Runs unattended once configured.",
        "credentialFields": [
            {"name": "clientId", "label": "Client ID", "secret": False, "placeholder": "ADP API client ID"},
            {"name": "clientSecret", "label": "Client secret", "secret": True, "placeholder": "ADP API client secret"},
            {"name": "certificatePem", "label": "Client certificate (PEM)", "secret": True, "placeholder": "-----BEGIN CERTIFICATE-----"},
            {"name": "privateKeyPem", "label": "Private key (PEM)", "secret": True, "placeholder": "-----BEGIN PRIVATE KEY-----"},
        ],
        "environments": ["production"],
        "testable": True,
    },
    {
        "id": "digits_api", "displayName": "Digits API", "authKind": "api_credentials",
        "category": "Unattended", "schedule": "Daily 06:00",
        "description": "Pulls fleet charges directly from Digits, replacing the monthly export upload.",
        "feeds": ["Fleet Costs"],
        "secretNames": ["client-id", "client-secret"],
        "credentialFields": [
            {"name": "clientId", "label": "Client ID", "secret": False, "placeholder": "Digits client ID"},
            {"name": "clientSecret", "label": "Client secret", "secret": True, "placeholder": "Digits client secret"},
        ],
        "environments": ["development", "production"],
        "testable": True,
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
]
BY_ID = {c["id"]: c for c in CATALOG}


# Upload sources accepted for financial charges, newest id first. The legacy
# "digits" id is still read so earlier uploads keep working.
FINANCIAL_SOURCES = ("financial_charges", "digits")

# Connections whose credentials live in managed secret storage. The registry
# reports only whether each required name is configured, never its value.
CREDENTIAL_SOURCES = ("digits_api", "adp", "email_imap")

SECRET_FIELD_NAMES = {
    "email_imap": {
        "host": "production-host", "port": "production-port",
        "username": "production-username", "appPassword": "production-app-password",
    },
    "adp": {
        "clientId": "production-client-id", "clientSecret": "production-client-secret",
        "certificatePem": "production-certificate-pem", "privateKeyPem": "production-private-key-pem",
    },
}

SESSION_STATE_PATHS = {
    "amazon": ROOT / ".openclaw" / "amazon-logistics-storage-state.json",
    "pave": ROOT / ".openclaw" / "pave-storage-state.json",
}


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
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, indent=2))
    os.replace(temporary, path)


def secret_reference(tenant: str, connection_id: str, name: str) -> str:
    provider = "aws-secrets"
    integration = connection_id.replace("_", "-")
    return f"secret://{tenant}/{provider}/{integration}/{name}"


def set_connection_state(tenant: str, connection_id: str, **changes) -> dict:
    if connection_id not in BY_ID:
        raise KeyError(f"unknown connection: {connection_id}")
    with _STATE_LOCK:
        state = _read_state(tenant)
        record = state.get(connection_id, {})
        record.update(changes)
        record["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        state[connection_id] = record
        _write_state(tenant, state)
        return record


def list_connections(tenant: str, upload_index=None) -> list:
    """Merge the catalog with stored per-tenant state and upload activity."""
    with _STATE_LOCK:
        state = _read_state(tenant)
    uploads = upload_index or {}
    result = []
    for entry in CATALOG:
        stored = state.get(entry["id"], {})
        if entry["id"] == "amazon" and not stored:
            legacy = [state.get(key) for key in ("amazon_logistics", "amazon_payments", "fleet_portal") if state.get(key)]
            if legacy:
                rank = {"needs_reauth": 0, "degraded": 1, "not_connected": 2, "pending": 3, "healthy": 4}
                stored = min(legacy, key=lambda item: rank.get(item.get("status", "not_connected"), 2))
        status = stored.get("status", "not_connected")
        last_success = stored.get("lastSuccessAt")

        # Reconstruct configuration metadata from durable secrets/session state
        # when the derived connections.json file is missing. Restarts must not
        # make valid credentials appear erased.
        field_names = SECRET_FIELD_NAMES.get(entry["id"], {})
        detected_fields = [
            public_name for public_name, secret_name in field_names.items()
            if has_secret(tenant, entry["id"].replace("_", "-"), secret_name)
        ]
        if entry["id"] == "email_imap":
            detected_fields = [
                public_name for public_name, secret_name in field_names.items()
                if has_secret(tenant, "email-imap", secret_name)
            ]
        if detected_fields:
            stored = {
                **stored,
                "configuredFields": sorted(set(stored.get("configuredFields", [])) | set(detected_fields)),
                "secretReference": stored.get("secretReference") or secret_reference(
                    tenant, entry["id"], "credentials"),
                "environment": stored.get("environment") or "production",
            }
            if status == "not_connected" and len(detected_fields) == len(field_names):
                status = "pending"

        session_path = SESSION_STATE_PATHS.get(entry["id"])
        if session_path and session_path.exists():
            stored = {
                **stored,
                "secretReference": stored.get("secretReference") or secret_reference(
                    tenant, entry["id"], "browser-session"),
            }
            if status == "not_connected":
                status = "pending"

        # Credentials created by the hidden-prompt CLI predate the connection
        # registry. Recognize those values without reading or returning them so
        # the UI accurately reports the already-configured Digits environment.
        if entry["id"] == "digits_api" and not stored.get("secretReference"):
            configured_envs = [
                env for env in ("development", "production")
                if has_secret(tenant, "digits", f"{env}-client-id")
                and has_secret(tenant, "digits", f"{env}-client-secret")
            ]
            if configured_envs:
                stored = {
                    **stored,
                    "secretReference": secret_reference(tenant, entry["id"], "credentials"),
                    "environment": configured_envs[0],
                    "configuredFields": ["clientId", "clientSecret"],
                }
                if status == "not_connected":
                    status = "pending"

        if entry["authKind"] == "manual_upload":
            latest = uploads.get(entry["id"])
            if latest:
                status = "healthy"
                last_success = latest.get("confirmedAt") or latest.get("uploadedAt")

        configured_fields = stored.get("configuredFields", [])
        public_fields = [
            {**field, "configured": field["name"] in configured_fields}
            for field in entry.get("credentialFields", [])
        ]
        configured = bool(stored.get("secretReference")) or status != "not_connected"
        if entry["authKind"] == "browser_session":
            configured = SESSION_STATE_PATHS.get(entry["id"], Path()).exists() or status != "not_connected"
        result.append({
            **entry,
            "reconnectAvailable": (
                entry["authKind"] == "browser_session"
                and entry["id"] in ("amazon", "pave")
            ),
            "credentialFields": public_fields,
            "status": status,
            "configured": configured,
            "secretReference": stored.get("secretReference"),
            "lastSuccessAt": last_success,
            "lastCheckedAt": stored.get("lastCheckedAt"),
            "lastError": stored.get("lastError"),
            "lastAutomatedSyncAt": stored.get("lastAutomatedSyncAt"),
            "nextRunAt": stored.get("nextRunAt"),
            "lastSyncSummary": stored.get("lastSyncSummary"),
            "sessionExpiresAt": stored.get("sessionExpiresAt"),
            "reauthRequiredAt": stored.get("reauthRequiredAt"),
            "latestUpload": uploads.get(entry["id"]),
            "environment": stored.get("environment"),
        })
    order = {"needs_reauth": 0, "degraded": 1, "not_connected": 2, "pending": 3, "healthy": 4, "disabled": 5}
    result.sort(key=lambda c: (order.get(c["status"], 9), c["displayName"]))
    return result
