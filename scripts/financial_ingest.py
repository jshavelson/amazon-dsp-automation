"""Provider-agnostic ingestion of tenant financial exports.

Supports Digits, QuickBooks (Online and Desktop report exports), and a generic
column-matched CSV/XLSX. Every provider produces the same normalized charge
shape so downstream reporting never knows which accounting system a tenant uses.

Vendor classification is tenant-configurable: a vendor we cannot classify is
surfaced for mapping rather than silently included or dropped.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TENANT_ROOT = ROOT / "data/tenants"

# Aliases are ordered most specific first; an exact header match always wins.
ALIASES = {
    "datePosted": ("date posted", "posted on", "post date", "transaction date", "txn date", "posted", "date"),
    "vendor": ("party name", "vendor name", "payee name", "vendor", "merchant", "payee",
               "supplier", "party", "name", "description"),
    "account": ("category name", "expense category", "gl account", "expense account",
                "account", "class", "category"),
    "netCharge": ("net charge", "net amount", "amount", "net", "total", "charge", "open balance"),
    # Ledger exports split the amount across two columns; netted at parse time.
    "debit": ("debit", "debit amount"),
    "credit": ("credit", "credit amount"),
    "memo": ("memo description", "memo", "note", "notes", "detail"),
    # Some exports (the reviewed reconciliation workbook) already carry the
    # include/exclude decision; honour it instead of re-deriving one.
    "treatment": ("treatment", "disposition"),
    # The card or bank the charge was paid from, never the expense category.
    "paymentAccount": ("split category name", "payment account", "paid from", "card"),
    "vin": ("vin", "vin input", "vehicle id", "vehicle", "asset"),
    "invoice": ("invoice number", "invoice input", "invoice", "num", "ref number", "reference", "ref"),
    "serviceStart": ("service start", "period start", "rental start", "start date"),
    "serviceEnd": ("service end", "period end", "rental end", "end date"),
    "transactionType": ("transaction type", "type"),
}

AMOUNT_FIELDS = ("netCharge", "debit", "credit")

# An expense-category column must never be mistaken for the payee.
VENDOR_BLOCKLIST = ("category", "account", "class", "department", "location")


def _has_amount(mapping: dict) -> bool:
    return any(field in mapping for field in AMOUNT_FIELDS)

# Rows a grouped accounting report uses for structure, never for money.
SUBTOTAL_PREFIXES = ("total", "subtotal", "grand total", "beginning balance", "ending balance")

# Default classification. Tenants override these; they are only a starting point.
DEFAULT_VENDOR_RULES = [
    {"match": "enterprise", "vendor": "Enterprise Rent-A-Car", "treatment": "INCLUDE", "coverageClass": "Rental + lease coverage"},
    {"match": "hertz", "vendor": "Hertz", "treatment": "INCLUDE", "coverageClass": "Rental + lease coverage"},
    {"match": "merchauto", "vendor": "MerchAuto9150 Corp", "treatment": "INCLUDE", "coverageClass": "Amazon LMR coverage"},
    {"match": "element", "vendor": "Element Fleet", "treatment": "INCLUDE", "coverageClass": "Unallocated"},
    {"match": "acura", "vendor": "Acura", "treatment": "EXCLUDE", "coverageClass": "Excluded from fleet comparison"},
    # Insurance is never a rental/lease charge and Amazon does not reimburse it
    # under a fleet coverage class, so it is excluded by name as well as by
    # expense category below.
    {"match": "rt specialty", "vendor": "RT Specialty", "treatment": "EXCLUDE", "coverageClass": "Insurance (not reimbursable)"},
    {"match": "insurance", "vendor": "Insurance", "treatment": "EXCLUDE", "coverageClass": "Insurance (not reimbursable)"},
]

# Inclusion is driven by the EXPENSE CATEGORY, not the payee. Tenants whose
# accounting system names the category differently override this.
DEFAULT_INCLUDED_ACCOUNTS = ("van rental",)

# Categories that are never reimbursable, whatever the payee is called.
EXCLUDED_ACCOUNT_PATTERNS = ("insurance",)


def category_rules_path(tenant: str) -> Path:
    return TENANT_ROOT / tenant / "category-rules.json"


def load_category_rules(tenant: str) -> list:
    path = category_rules_path(tenant)
    if path.exists():
        try:
            stored = json.loads(path.read_text())
            included = stored.get("included") if isinstance(stored, dict) else stored
            if isinstance(included, list) and included:
                return [str(v).strip().lower() for v in included if str(v).strip()]
        except Exception:
            pass
    return list(DEFAULT_INCLUDED_ACCOUNTS)


def save_category_rules(tenant: str, patterns: list) -> list:
    cleaned = [str(v).strip().lower() for v in patterns if str(v).strip()]
    path = category_rules_path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "included": cleaned}, indent=2))
    return cleaned


def decide_treatment(vendor_name: str, account_value: str, rules, included_patterns,
                     stated: str = ""):
    """Single source of truth for include/exclude, shared by every ingest path.

    Returns (canonical_vendor, treatment, coverage_class, is_unmapped).
    Precedence, strictest first:
      0. an export that already states a treatment is trusted as-is
      1. only an included expense category can ever be claimed
      2. an excluded category (insurance) overrides everything
      3. a vendor with no rule is excluded but surfaced for mapping
      4. an explicit vendor EXCLUDE rule can still veto
      5. otherwise include, using the vendor rule for the coverage class
    """
    canonical, rule_treatment, coverage = classify(vendor_name, rules)
    stated = _norm(stated)

    if stated:
        if stated.startswith("include"):
            return canonical, "INCLUDE", coverage, coverage == "Unmapped vendor"
        return canonical, "EXCLUDE", "Excluded in source export", False
    if not _account_is_included(account_value, included_patterns):
        return canonical, "EXCLUDE", "Not a fleet rental category", False
    if _account_is_excluded(account_value):
        return canonical, "EXCLUDE", "Insurance (not reimbursable)", False
    if coverage == "Unmapped vendor":
        return canonical, "EXCLUDE", coverage, True
    if rule_treatment == "EXCLUDE":
        return canonical, "EXCLUDE", coverage, False
    return canonical, "INCLUDE", coverage, False


def summarize_charges(charges: list) -> dict:
    """Build the standard summary block from normalized charges."""
    included = [c for c in charges if c["treatment"] == "INCLUDE"]
    by_vendor = {}
    for charge in included:
        entry = by_vendor.setdefault(charge["vendor"], {
            "vendor": charge["vendor"], "count": 0, "total": 0.0,
            "coverageClass": charge["coverageClass"]})
        entry["count"] += 1
        entry["total"] = round(entry["total"] + charge["netCharge"], 2)
    unmapped = {}
    for charge in charges:
        if charge.get("_unmapped"):
            unmapped[charge["vendor"]] = unmapped.get(charge["vendor"], 0) + 1
    return {
        "total": len(charges),
        "included": len(included),
        "excluded": len(charges) - len(included),
        "includedTotal": round(sum(c["netCharge"] for c in included), 2),
        "excludedTotal": round(sum(c["netCharge"] for c in charges if c["treatment"] != "INCLUDE"), 2),
        "unmatchedVin": sum(1 for c in included if not c.get("vin")),
        "byVendor": sorted(by_vendor.values(), key=lambda v: -v["total"]),
        "unmappedVendors": [{"vendor": k, "count": v} for k, v in sorted(unmapped.items(), key=lambda kv: -kv[1])],
    }


def _account_is_included(account: str, patterns) -> bool:
    key = _norm(account)
    return any(pattern in key for pattern in patterns)


def _account_is_excluded(account: str) -> bool:
    key = _norm(account)
    return any(pattern in key for pattern in EXCLUDED_ACCOUNT_PATTERNS)


def _norm(value) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", str(value or "").strip().lower()).strip()


# ----------------------------------------------------------------- vendor rules

def vendor_rules_path(tenant: str) -> Path:
    return TENANT_ROOT / tenant / "vendor-rules.json"


def load_vendor_rules(tenant: str) -> list:
    path = vendor_rules_path(tenant)
    if path.exists():
        try:
            stored = json.loads(path.read_text())
            rules = stored.get("rules") if isinstance(stored, dict) else stored
            if isinstance(rules, list) and rules:
                return rules
        except Exception:
            pass
    return list(DEFAULT_VENDOR_RULES)


def save_vendor_rules(tenant: str, rules: list) -> list:
    cleaned = []
    for rule in rules:
        match = str(rule.get("match", "")).strip().lower()
        if not match:
            continue
        cleaned.append({
            "match": match,
            "vendor": str(rule.get("vendor") or match).strip(),
            "treatment": "INCLUDE" if str(rule.get("treatment", "INCLUDE")).upper() == "INCLUDE" else "EXCLUDE",
            "coverageClass": str(rule.get("coverageClass") or "Unallocated").strip(),
        })
    path = vendor_rules_path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "rules": cleaned}, indent=2))
    return cleaned


def classify(vendor: str, rules: list):
    """Return (canonical_vendor, treatment, coverage_class)."""
    key = _norm(vendor)
    for rule in rules:
        if rule["match"] in key:
            return rule["vendor"], rule["treatment"], rule["coverageClass"]
    return (vendor or "Unknown").strip(), "EXCLUDE", "Unmapped vendor"


# -------------------------------------------------------------------- providers

def _match_columns(headers: list) -> dict:
    normalized = [_norm(h) for h in headers]
    scored = {}
    for field, aliases in ALIASES.items():
        best = None
        for index, header in enumerate(normalized):
            if not header:
                continue
            if field == "vendor" and any(word in header for word in VENDOR_BLOCKLIST):
                continue
            for rank, alias in enumerate(aliases):
                if header == alias:
                    score = (0, rank)
                elif header.startswith(alias) or header.endswith(alias):
                    score = (1, rank)
                elif alias in header:
                    score = (2, rank)
                else:
                    continue
                if best is None or score < best[0]:
                    best = (score, index)
                break
        if best is not None:
            scored[field] = best
    mapping, claimed = {}, set()
    for field, (score, index) in sorted(scored.items(), key=lambda kv: kv[1][0]):
        if index in claimed:
            continue
        mapping[field] = index
        claimed.add(index)
    return mapping


# Columns unique to a QuickBooks report export.
QUICKBOOKS_STRONG = ("transaction type", "memo description", "quickbooks",
                     "expenses by vendor", "transaction list by vendor",
                     "profit and loss", "general ledger")
# Present in QuickBooks but also in other ledgers, so only meaningful together.
QUICKBOOKS_WEAK = ("split", "num")
# Columns unique to a Digits ledger export.
DIGITS_SIGNALS = ("party name", "category name", "split category")


def detect_provider(headers: list, preamble: list, filename: str) -> tuple:
    """Return (provider_id, confidence, reason)."""
    name = (filename or "").lower()
    header_text = " ".join(_norm(h) for h in (headers or []))
    preamble_text = " ".join(_norm(c) for row in (preamble or []) for c in row)
    text = header_text + " " + preamble_text

    if "quickbooks" in name or "quickbooks" in preamble_text:
        return "quickbooks", 0.95, "QuickBooks named in the file or report header"
    if "digit" in name:
        return "digits", 0.9, "Digits named in the file"

    strong = [s for s in QUICKBOOKS_STRONG if s in text]
    if strong:
        return "quickbooks", 0.9, "QuickBooks report columns detected: " + ", ".join(strong[:3])

    digits_hits = [s for s in DIGITS_SIGNALS if s in text]
    if len(digits_hits) >= 2:
        return "digits", 0.85, "Digits ledger columns detected: " + ", ".join(digits_hits[:3])
    if "net charge" in header_text:
        return "digits", 0.8, "Digits net-charge column layout"

    weak = [s for s in QUICKBOOKS_WEAK if s in text]
    if len(weak) >= 2:
        return "quickbooks", 0.6, "Partial QuickBooks signal: " + ", ".join(weak)
    if digits_hits:
        return "digits", 0.6, "Partial Digits signal: " + digits_hits[0]
    return "generic", 0.4, "Matched by column names only"


PROVIDER_LABELS = {
    "digits": "Digits",
    "quickbooks": "QuickBooks",
    "generic": "Generic CSV / spreadsheet",
}


# ------------------------------------------------------------------- row reading

def _to_cents(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value) * 100))
    text = str(value).strip()
    if not text:
        return None
    negative = (text.startswith("(") and text.endswith(")")) or text.startswith("-")
    cleaned = re.sub(r"[^0-9.]", "", text)
    if not cleaned or cleaned == ".":
        return None
    amount = float(cleaned)
    return int(round(-amount * 100 if negative else amount * 100))


def _to_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()[:11]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d-%b-%Y", "%b %d, %Y", "%b %d %Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _row_amount(cell_fn, row, mapping):
    """Net amount for a row: one amount column, or debit minus credit."""
    if "netCharge" in mapping:
        return _to_cents(cell_fn(row, "netCharge"))
    debit = _to_cents(cell_fn(row, "debit")) if "debit" in mapping else None
    credit = _to_cents(cell_fn(row, "credit")) if "credit" in mapping else None
    if debit is None and credit is None:
        return None
    return (debit or 0) - (credit or 0)


def _is_subtotal(row) -> bool:
    first = _norm(row[0] if row else "")
    return any(first.startswith(prefix) for prefix in SUBTOTAL_PREFIXES)


def _sheet_rows(payload: bytes, filename: str):
    if filename.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        workbook = load_workbook(io.BytesIO(payload), data_only=True, read_only=True)
        best = None
        for sheet in workbook.worksheets:
            rows = [list(r) for r in sheet.iter_rows(values_only=True) if any(v is not None for v in r)]
            if rows and (best is None or len(rows) > len(best)):
                best = rows
        workbook.close()
        return best or []
    text = payload.decode("utf-8-sig", errors="replace")
    return [r for r in csv.reader(io.StringIO(text)) if any(str(c).strip() for c in r)]


def _find_header(rows: list):
    """Locate the header row, tolerating accounting report title/date rows."""
    for offset, row in enumerate(rows[:12]):
        mapping = _match_columns(row)
        if "vendor" in mapping and _has_amount(mapping):
            return offset, row, mapping
    # QuickBooks grouped reports omit a vendor column entirely.
    for offset, row in enumerate(rows[:12]):
        mapping = _match_columns(row)
        if _has_amount(mapping) and ("datePosted" in mapping or "transactionType" in mapping):
            return offset, row, mapping
    return None, None, {}


# ----------------------------------------------------------------------- parsing

def parse_financial_export(payload: bytes, filename: str, tenant: str = None,
                           provider: str = None, vendor_rules: list = None,
                           included_accounts=None) -> dict:
    """Parse any supported export into normalized charges for tenant review."""
    rules = vendor_rules if vendor_rules is not None else load_vendor_rules(tenant or "jecs")
    included_patterns = (list(included_accounts) if included_accounts is not None
                         else load_category_rules(tenant or "jecs"))
    rows = _sheet_rows(payload, filename)
    if not rows:
        return {"ok": False, "error": "The file contained no readable rows.", "charges": []}

    offset, headers, mapping = _find_header(rows)
    if headers is None:
        return {"ok": False,
                "error": "No table with recognizable financial columns was found.",
                "detectedHeaders": [str(c) for c in rows[0][:12] if c is not None],
                "expected": {k: list(ALIASES[k]) for k in ("vendor",) + AMOUNT_FIELDS},
                "charges": []}

    preamble = rows[:offset]
    detected, confidence, reason = detect_provider(headers, preamble, filename)
    provider_id = provider or detected

    def cell(row, field):
        index = mapping.get(field)
        return row[index] if index is not None and index < len(row) else None

    has_vendor_column = "vendor" in mapping
    has_treatment_column = "treatment" in mapping
    charges, skipped, subtotals, unmapped = [], 0, 0, {}
    section_vendor = None

    for row in rows[offset + 1:]:
        if _is_subtotal(row):
            subtotals += 1
            continue

        cents = _row_amount(cell, row, mapping)
        raw_vendor = str(cell(row, "vendor") or "").strip() if has_vendor_column else ""

        # QuickBooks grouped reports put the vendor on its own section row.
        if cents is None:
            populated = [c for c in row if str(c or "").strip()]
            if len(populated) == 1:
                section_vendor = str(populated[0]).strip()
            else:
                skipped += 1
            continue

        vendor_name = raw_vendor or section_vendor
        if not vendor_name:
            skipped += 1
            continue

        canonical, rule_treatment, coverage = classify(vendor_name, rules)
        account_value = str(cell(row, "account") or "").strip()
        stated = _norm(cell(row, "treatment")) if has_treatment_column else ""

        # Precedence, strictest first:
        #  0. an export that already states a treatment is trusted as-is
        #  1. only an included expense category can ever be claimed
        #  2. an excluded category (insurance) overrides everything
        #  3. a vendor with no rule is excluded but surfaced for mapping
        #  4. an explicit vendor EXCLUDE rule can still veto (e.g. Acura)
        #  5. otherwise include, using the vendor rule for the coverage class
        if stated:
            treatment = "INCLUDE" if stated.startswith("include") else "EXCLUDE"
            if treatment == "EXCLUDE":
                coverage = "Excluded in source export"
            elif coverage == "Unmapped vendor":
                unmapped[canonical] = unmapped.get(canonical, 0) + 1
        elif not _account_is_included(account_value, included_patterns):
            treatment = "EXCLUDE"
            coverage = "Not a fleet rental category"
        elif _account_is_excluded(account_value):
            treatment, coverage = "EXCLUDE", "Insurance (not reimbursable)"
        elif coverage == "Unmapped vendor":
            # Inside a claimable category but unrecognised: never guessed,
            # excluded for now and offered to the tenant to classify.
            treatment = "EXCLUDE"
            unmapped[canonical] = unmapped.get(canonical, 0) + 1
        elif rule_treatment == "EXCLUDE":
            treatment = "EXCLUDE"
        else:
            treatment = "INCLUDE"

        posted = _to_date(cell(row, "datePosted"))
        charges.append({
            "datePosted": posted.isoformat() if posted else None,
            "periodKey": posted.strftime("%Y-%m") if posted else None,
            "month": posted.strftime("%B") if posted else None,
            "vendor": canonical,
            "rawVendor": vendor_name,
            "account": account_value or None,
            "paymentAccount": str(cell(row, "paymentAccount") or "").strip() or None,
            "netCharge": round(cents / 100, 2),
            "treatment": treatment,
            "coverageClass": coverage,
            "memo": str(cell(row, "memo") or "").strip() or None,
            "vin": str(cell(row, "vin") or "").strip() or None,
            "invoice": str(cell(row, "invoice") or "").strip() or None,
            "serviceStart": (lambda d: d.isoformat() if d else None)(_to_date(cell(row, "serviceStart"))),
            "serviceEnd": (lambda d: d.isoformat() if d else None)(_to_date(cell(row, "serviceEnd"))),
        })

    included = [c for c in charges if c["treatment"] == "INCLUDE"]
    periods = sorted({c["periodKey"] for c in charges if c["periodKey"]})
    by_vendor = {}
    for charge in included:
        entry = by_vendor.setdefault(charge["vendor"], {
            "vendor": charge["vendor"], "count": 0, "total": 0.0, "coverageClass": charge["coverageClass"]})
        entry["count"] += 1
        entry["total"] = round(entry["total"] + charge["netCharge"], 2)

    return {
        "ok": True,
        "provider": provider_id,
        "providerLabel": PROVIDER_LABELS.get(provider_id, provider_id),
        "providerConfidence": round(confidence, 2),
        "providerReason": reason,
        "groupedBySection": not has_vendor_column,
        "columnMapping": {k: (headers[v] if v < len(headers) else None) for k, v in mapping.items()},
        "unmappedColumns": [str(h) for i, h in enumerate(headers) if h and i not in mapping.values()],
        "rowsRead": len(rows) - offset - 1,
        "rowsSkipped": skipped,
        "subtotalRowsIgnored": subtotals,
        "charges": charges,
        "periods": periods,
        "periodKey": periods[0] if len(periods) == 1 else None,
        "summary": {
            "total": len(charges),
            "included": len(included),
            "excluded": len(charges) - len(included),
            "includedTotal": round(sum(c["netCharge"] for c in included), 2),
            "excludedTotal": round(sum(c["netCharge"] for c in charges if c["treatment"] != "INCLUDE"), 2),
            "unmatchedVin": sum(1 for c in included if not c["vin"]),
            "byVendor": sorted(by_vendor.values(), key=lambda v: -v["total"]),
            "unmappedVendors": [{"vendor": k, "count": v} for k, v in sorted(unmapped.items(), key=lambda kv: -kv[1])],
        },
    }
