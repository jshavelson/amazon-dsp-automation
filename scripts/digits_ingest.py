"""Digits-specific entry point.

Kept as a thin wrapper so existing callers keep working; all parsing now lives
in financial_ingest, which supports Digits, QuickBooks, and generic exports.
"""
from __future__ import annotations

from scripts.financial_ingest import (  # noqa: F401  (re-exported for callers)
    ALIASES,
    DEFAULT_VENDOR_RULES,
    classify as _classify_with_rules,
    load_vendor_rules,
    parse_financial_export,
)


def parse_digits_export(payload: bytes, filename: str, tenant: str = None, vendor_rules=None) -> dict:
    return parse_financial_export(payload, filename, tenant=tenant, vendor_rules=vendor_rules)


def classify(vendor: str, rules=None):
    return _classify_with_rules(vendor, rules if rules is not None else DEFAULT_VENDOR_RULES)
