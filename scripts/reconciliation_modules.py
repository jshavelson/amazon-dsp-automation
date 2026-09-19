#!/usr/bin/env python3
"""Pure reconcilers used by the four import-driven reconciliation modules."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from reconciliation_core import money, parse_date, pick


ID = ("claim_id", "claim id", "reference_id", "reference id", "id")
AMOUNT = ("amount", "approved_amount", "reimbursement_amount", "paid_amount", "invoice_amount")
EMPLOYEE = ("employee_id", "employee id", "associate_id", "worker_id", "employee")
DATE = ("date", "approved_date", "disbursement_date", "work_date", "invoice_date")


def by_id(rows: list[dict[str, Any]], aliases: tuple[str, ...] = ID) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(pick(row, aliases, required=True)).strip()
        if key in result:
            raise ValueError(f"Duplicate identifier {key!r}")
        result[key] = row
    return result


def fif_findings(approved: list[dict[str, Any]], paid: list[dict[str, Any]]) -> list[dict[str, Any]]:
    left, right = by_id(approved), by_id(paid)
    findings = []
    for claim_id in sorted(set(left) | set(right)):
        approved_amount = money(pick(left.get(claim_id, {}), AMOUNT), Decimal(0)) if claim_id in left else None
        paid_amount = money(pick(right.get(claim_id, {}), AMOUNT), Decimal(0)) if claim_id in right else None
        candidate = approved_amount is not None and (paid_amount is None or paid_amount < approved_amount)
        status = "pass"
        direction = "matched"
        if claim_id not in left:
            status, direction = "review", "paid_without_approved_claim"
        elif paid_amount is None:
            status, direction = "review", "approved_not_paid"
        elif paid_amount != approved_amount:
            status, direction = "review", "amount_mismatch"
        findings.append({
            "claim_id": claim_id,
            "approved_amount": approved_amount,
            "paid_amount": paid_amount,
            "difference": (paid_amount or Decimal(0)) - (approved_amount or Decimal(0)),
            "status": status,
            "direction": direction,
            "dispute_candidate": candidate,
        })
    return findings


EXCLUDED_WORK = ("transportation", "ore", "on-road experience", "cdat", "swa", "mfn", "missort")


def fifth_day_findings(routes: list[dict[str, Any]], payroll: list[dict[str, Any]]) -> list[dict[str, Any]]:
    worked: dict[str, set[date]] = {}
    excluded: dict[str, int] = {}
    for row in routes:
        employee = str(pick(row, EMPLOYEE, required=True)).strip()
        service = str(pick(row, ("service_type", "service type", "work_type", "route_type")) or "").lower()
        day = parse_date(pick(row, DATE, required=True))
        if any(term in service for term in EXCLUDED_WORK):
            excluded[employee] = excluded.get(employee, 0) + 1
            continue
        worked.setdefault(employee, set()).add(day)  # type: ignore[arg-type]
    paid: dict[str, Decimal] = {}
    for row in payroll:
        employee = str(pick(row, EMPLOYEE, required=True)).strip()
        paid[employee] = paid.get(employee, Decimal(0)) + (money(pick(row, ("fifth_day_amount", "fifth day amount", "reimbursement_amount", "amount")), Decimal(0)) or Decimal(0))
    findings = []
    for employee in sorted(set(worked) | set(paid)):
        days = len(worked.get(employee, set()))
        qualifies = days >= 5
        paid_amount = paid.get(employee, Decimal(0))
        candidate = qualifies and paid_amount <= 0
        findings.append({
            "employee_id": employee,
            "eligible_work_days": days,
            "excluded_work_records": excluded.get(employee, 0),
            "payroll_reimbursement": paid_amount,
            "status": "review" if candidate else "pass",
            "direction": "qualified_not_reimbursed" if candidate else "matched_or_not_eligible",
            "dispute_candidate": candidate,
        })
    return findings


def next_mile_findings(disbursements: list[dict[str, Any]], payroll: list[dict[str, Any]], as_of: date) -> list[dict[str, Any]]:
    paid: dict[str, Decimal] = {}
    for row in payroll:
        employee = str(pick(row, EMPLOYEE, required=True)).strip()
        paid[employee] = paid.get(employee, Decimal(0)) + (money(pick(row, AMOUNT), Decimal(0)) or Decimal(0))
    findings = []
    for row in disbursements:
        employee = str(pick(row, EMPLOYEE, required=True)).strip()
        amount = money(pick(row, AMOUNT, required=True), Decimal(0)) or Decimal(0)
        disbursed = parse_date(pick(row, DATE, required=True))
        age = (as_of - disbursed).days  # type: ignore[operator]
        payroll_amount = paid.get(employee, Decimal(0))
        candidate = age > 45 and payroll_amount < amount
        findings.append({
            "employee_id": employee,
            "disbursement_date": disbursed,
            "age_days": age,
            "disbursement_amount": amount,
            "payroll_reimbursement": payroll_amount,
            "difference": payroll_amount - amount,
            "status": "review" if candidate else ("monitor" if payroll_amount < amount else "pass"),
            "direction": "overdue_not_reimbursed" if candidate else ("within_45_day_window" if payroll_amount < amount else "matched"),
            "dispute_candidate": candidate,
        })
    return findings


def adjustment_findings(expected: list[dict[str, Any]], invoiced: list[dict[str, Any]]) -> list[dict[str, Any]]:
    left, right = by_id(expected, ("program_id", "program id", "reference_id", "award_id", "id")), by_id(invoiced, ("program_id", "program id", "reference_id", "award_id", "id"))
    findings = []
    for item_id in sorted(set(left) | set(right)):
        expected_amount = money(pick(left.get(item_id, {}), AMOUNT), Decimal(0)) if item_id in left else None
        invoice_amount = money(pick(right.get(item_id, {}), AMOUNT), Decimal(0)) if item_id in right else None
        candidate = expected_amount is not None and (invoice_amount is None or invoice_amount < expected_amount)
        direction = "matched"
        if item_id not in left:
            direction = "invoice_without_support"
        elif invoice_amount is None:
            direction = "eligible_adjustment_missing"
        elif invoice_amount != expected_amount:
            direction = "amount_mismatch"
        findings.append({
            "program_id": item_id,
            "expected_amount": expected_amount,
            "invoice_amount": invoice_amount,
            "status": "pass" if direction == "matched" else "review",
            "direction": direction,
            "dispute_candidate": candidate,
        })
    return findings
