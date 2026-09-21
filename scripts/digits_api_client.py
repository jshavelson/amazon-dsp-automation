"""Digits Connect API client for fleet charge ingestion.

Credentials are read from managed secret storage at the moment of use and are
never logged, cached to disk, or returned. Access tokens live in memory only.

Normalized output matches scripts/financial_ingest exactly, so the API and the
CSV upload feed the same classification pipeline and the same reporting shape.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.financial_ingest import (  # noqa: E402
    decide_treatment,
    load_category_rules,
    load_vendor_rules,
    summarize_charges,
)
from scripts.secret_store import get_secret, has_secret  # noqa: E402

INTEGRATION = "digits"
PAGE_LIMIT = 100
MAX_PAGES = 200

# Credentials are environment-scoped so development and production keys can
# coexist and can never be confused for one another. Digits serves both from
# the same host; only the credential pair differs.
ENVIRONMENTS = {
    "development": {"baseUrl": "https://connect.digits.com", "label": "Development"},
    "production": {"baseUrl": "https://connect.digits.com", "label": "Production"},
}
DEFAULT_ENVIRONMENT = "development"


def secret_name(environment: str, name: str) -> str:
    if environment not in ENVIRONMENTS:
        raise DigitsError(f"unknown Digits environment: {environment}")
    return f"{environment}-{name}"


def base_url(environment: str) -> str:
    if environment not in ENVIRONMENTS:
        raise DigitsError(f"unknown Digits environment: {environment}")
    return ENVIRONMENTS[environment]["baseUrl"]

# The local shell proxy rejects external CONNECT; talk to Digits directly.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_TOKEN_CACHE: dict = {}


class DigitsError(RuntimeError):
    pass


def credentials_configured(tenant: str, environment: str = DEFAULT_ENVIRONMENT) -> bool:
    return (has_secret(tenant, INTEGRATION, secret_name(environment, "client-id"))
            and has_secret(tenant, INTEGRATION, secret_name(environment, "client-secret")))


def configured_environments(tenant: str) -> list:
    """Which Digits environments this workspace has credentials for."""
    return [env for env in ENVIRONMENTS if credentials_configured(tenant, env)]


def _request(method: str, path: str, tenant: str, token: str = None,
             params: dict = None, body: dict = None, timeout: int = 40,
             environment: str = DEFAULT_ENVIRONMENT):
    url = base_url(environment) + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:300]
        # The body may echo request context; never include credentials here.
        raise DigitsError(f"Digits API {method} {path} failed: HTTP {error.code} {detail}") from None
    except Exception as error:
        raise DigitsError(f"Digits API {method} {path} unreachable: {type(error).__name__}") from None


def access_token(tenant: str, environment: str = DEFAULT_ENVIRONMENT) -> str:
    """Fetch (or reuse) a bearer token. Never logged or persisted."""
    cache_key = (tenant, environment)
    cached = _TOKEN_CACHE.get(cache_key)
    if cached and cached["expires"] > datetime.now(timezone.utc) + timedelta(seconds=60):
        return cached["token"]
    if not credentials_configured(tenant, environment):
        raise DigitsError(f"Digits {environment} credentials are not configured for this workspace")
    payload = _request("POST", "/v1/oauth/token", tenant, environment=environment, body={
        "grant_type": "client_credentials",
        "client_id": get_secret(tenant, INTEGRATION, secret_name(environment, "client-id")),
        "client_secret": get_secret(tenant, INTEGRATION, secret_name(environment, "client-secret")),
    }, timeout=30)
    token = payload.get("access_token")
    if not token:
        raise DigitsError("Digits returned no access token")
    _TOKEN_CACHE[cache_key] = {
        "token": token,
        "expires": datetime.now(timezone.utc) + timedelta(seconds=int(payload.get("expires_in") or 3600)),
        "scope": payload.get("scope"),
    }
    return token


def list_entities(tenant: str, environment: str = DEFAULT_ENVIRONMENT) -> list:
    token = access_token(tenant, environment)
    return (_request("GET", "/v1/organization/entities", tenant, token,
                     environment=environment) or {}).get("entities", [])


def list_categories(tenant: str, entity_id: str, environment: str = DEFAULT_ENVIRONMENT) -> list:
    token = access_token(tenant, environment)
    data = _request("GET", "/v1/ledger/categories", tenant, token, {"entity.id": entity_id},
                    environment=environment)
    return data.get("categories", data.get("category", []))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_entries(tenant: str, entity_id: str, start: datetime, end: datetime,
                  environment: str = DEFAULT_ENVIRONMENT) -> list:
    """Raw ledger entries for the half-open window [start, end).

    The Digits bounds are asymmetric and both needed correcting:
      * occurredAfter is EXCLUSIVE - a charge dated exactly on the period start
        is dropped. Verified: a 2026-06-01 Enterprise charge vanished at
        occurredAfter=2026-06-01, which under-reported June by $1,359.07.
      * occurredBefore is INCLUSIVE - querying up to 2026-09-01 pulled September
        charges into an June-August window.
    Both bounds are therefore shifted back one second.
    """
    token = access_token(tenant, environment)
    after = _iso(start - timedelta(seconds=1))
    before = _iso(end - timedelta(seconds=1))
    rows, cursor, pages = [], None, 0
    while pages < MAX_PAGES:
        params = {"entity.id": entity_id, "occurredAfter": after,
                  "occurredBefore": before, "limit": PAGE_LIMIT}
        if cursor:
            params["cursor"] = cursor
        data = _request("GET", "/v1/ledger/entries", tenant, token, params,
                        environment=environment)
        rows.extend(data.get("entryDetails", []))
        pages += 1
        nxt = data.get("next") or {}
        cursor = nxt.get("cursor")
        if not nxt.get("more") or not cursor:
            break
    return rows


def normalize_entries(rows: list, tenant: str, vendor_rules=None, included_accounts=None) -> dict:
    """Convert ledger entries into the standard charge shape and classify them."""
    rules = vendor_rules if vendor_rules is not None else load_vendor_rules(tenant)
    included = list(included_accounts) if included_accounts is not None else load_category_rules(tenant)

    charges = []
    for detail in rows:
        entry = detail.get("entry") or {}
        amount = (entry.get("amount") or {}).get("amount")
        if amount is None:
            continue
        # Digits amounts are minor units: $5.00 is 500.
        net = round(int(amount) / 100.0, 2)
        if str(entry.get("type", "")).strip().lower().startswith("credit"):
            net = -net

        category = ((entry.get("category") or {}).get("name") or "").strip()
        counterparty = ((entry.get("counterparty") or {}).get("name") or "").strip()
        raw_date = str(detail.get("date") or "")[:10]
        posted = None
        if raw_date:
            try:
                posted = datetime.strptime(raw_date, "%Y-%m-%d").date()
            except ValueError:
                posted = None

        vendor, treatment, coverage, unmapped = decide_treatment(
            counterparty, category, rules, included)

        charges.append({
            "datePosted": posted.isoformat() if posted else None,
            "periodKey": posted.strftime("%Y-%m") if posted else None,
            "month": posted.strftime("%B") if posted else None,
            "vendor": vendor,
            "rawVendor": counterparty,
            "account": category or None,
            "paymentAccount": None,
            "netCharge": net,
            "treatment": treatment,
            "coverageClass": coverage,
            "memo": (entry.get("description") or "").strip() or None,
            "vin": None,
            "invoice": detail.get("transactionId"),
            "serviceStart": None,
            "serviceEnd": None,
            "_unmapped": unmapped,
        })

    charges.sort(key=lambda c: (c["datePosted"] or "", c["vendor"]))
    periods = sorted({c["periodKey"] for c in charges if c["periodKey"]})
    return {
        "ok": True,
        "provider": "digits_api",
        "providerLabel": "Digits API",
        "rowsRead": len(rows),
        "charges": charges,
        "periods": periods,
        "periodKey": periods[0] if len(periods) == 1 else None,
        "summary": summarize_charges(charges),
    }


def pull_period(tenant: str, entity_id: str, start: datetime, end: datetime,
                environment: str = DEFAULT_ENVIRONMENT) -> dict:
    """Pull and classify one period. Provenance records which environment served it."""
    rows = fetch_entries(tenant, entity_id, start, end, environment)
    result = normalize_entries(rows, tenant)
    result["environment"] = environment
    result["environmentLabel"] = ENVIRONMENTS[environment]["label"]
    result["entityId"] = entity_id
    result["providerLabel"] = "Digits API (" + ENVIRONMENTS[environment]["label"] + ")"
    return result
