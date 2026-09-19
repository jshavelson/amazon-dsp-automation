#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from decimal import Decimal
from pathlib import Path
from typing import Iterable


MONEY = r"[\d,]+(?:\.\d+)?"
NUMBER = r"[\d,]+(?:\.\d+)?"


@dataclass(frozen=True)
class LineItem:
    description: str
    quantity: Decimal
    rate: Decimal
    amount: Decimal


def decimal_value(value: str) -> Decimal:
    return Decimal(value.replace(',', ''))


def normalize_space(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit('pypdf is required to read Amazon invoice PDFs') from exc
    return '\n'.join(page.extract_text() or '' for page in PdfReader(path).pages)


def source_fingerprint(path: Path, source_type: str) -> dict[str, object]:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return {
        'type': source_type,
        'path': str(path.resolve()),
        'sha256': digest.hexdigest(),
        'bytes': path.stat().st_size,
    }


def section(text: str, start: str, end: str) -> str:
    try:
        return text.split(start, 1)[1].split(end, 1)[0]
    except IndexError as exc:
        raise ValueError(f'Could not find invoice section {start!r} ... {end!r}') from exc


def parse_variable_items(text: str) -> list[LineItem]:
    raw = normalize_space(section(text, 'Description Rate Quantity Amount', 'Subtotal'))
    pattern = re.compile(
        rf'(?P<description>.+?)\s+\$(?P<rate>{MONEY})\s+'
        rf'(?P<quantity>{NUMBER})\s+\$(?P<amount>{MONEY})(?=\s+[A-Z]|$)'
    )
    return [
        LineItem(
            normalize_space(match.group('description')),
            decimal_value(match.group('quantity')),
            decimal_value(match.group('rate')),
            decimal_value(match.group('amount')),
        )
        for match in pattern.finditer(raw)
    ]


def parse_incentive_items(text: str) -> list[LineItem]:
    raw = normalize_space(section(text, 'Description Quantity Rate Amount', 'Total Due'))
    pattern = re.compile(
        rf'(?P<description>.+?)\s+(?P<quantity>{NUMBER})\s+'
        rf'\$(?P<rate>{MONEY})\s+\$(?P<amount>{MONEY})(?=\s+[A-Z]|$)'
    )
    return [
        LineItem(
            normalize_space(match.group('description')),
            decimal_value(match.group('quantity')),
            decimal_value(match.group('rate')),
            decimal_value(match.group('amount')),
        )
        for match in pattern.finditer(raw)
    ]


def find_total(text: str) -> Decimal:
    matches = re.findall(rf'Total Due\s+\$\s*(?P<amount>{MONEY})', text)
    if not matches:
        raise ValueError('Could not find Total Due')
    return decimal_value(matches[-1])


def find_week(text: str) -> tuple[int, int]:
    match = re.search(r'(?:week|Week)\s+(\d{1,2})(?:,|\s+Year)?\s+(\d{4})', text)
    if not match:
        raise ValueError('Could not identify invoice week and year')
    return int(match.group(1)), int(match.group(2))


def summarize_variable(items: Iterable[LineItem]) -> dict[str, object]:
    route_hours: dict[str, Decimal] = defaultdict(Decimal)
    experience_hours: dict[str, Decimal] = defaultdict(Decimal)
    delivered = Decimal(0)
    pickups = Decimal(0)
    pickup_by_rate: dict[str, Decimal] = defaultdict(Decimal)
    training_days = Decimal(0)

    for item in items:
        desc = item.description.lower()
        hours_match = re.search(r'block of\s+(\d+)\s+hours?', desc)
        hours = hours_match.group(1) if hours_match else None
        if 'variable per shipment' in desc and 'delivery complete' in desc and 'branding' not in desc:
            delivered += item.quantity
        elif 'variable per shipment' in desc and 'pickup complete' in desc:
            pickups += item.quantity
            pickup_by_rate[str(item.rate)] += item.quantity
        elif 'training - block' in desc:
            training_days += item.quantity
        elif hours and 'on-road experience' in desc:
            experience_hours[hours] += item.quantity
        elif hours and ('standard parcel' in desc or 'nursery route' in desc):
            route_hours[hours] += item.quantity

    return {
        'route_hours': dict(route_hours),
        'experience_hours': dict(experience_hours),
        'delivered_packages': delivered,
        'pickup_packages': pickups,
        'pickup_packages_by_rate': dict(pickup_by_rate),
        'training_days': training_days,
    }


def summarize_incentive(items: Iterable[LineItem]) -> dict[str, object]:
    delivery = next((item for item in items if 'delivery excellence incentive' in item.description.lower()), None)
    pickup = next((item for item in items if 'pickup excellence incentive' in item.description.lower()), None)
    rating_match = re.search(r'\(([^)]+)\)', delivery.description if delivery else '')
    return {
        'rating': normalize_space(rating_match.group(1)).title() if rating_match else 'Unknown',
        'delivery': delivery,
        'pickup': pickup,
    }


def compare_counts(variable: dict[str, object], incentive: dict[str, object]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    delivery: LineItem | None = incentive['delivery']  # type: ignore[assignment]
    pickup: LineItem | None = incentive['pickup']  # type: ignore[assignment]
    delivered = variable['delivered_packages']
    checks.append({
        'check': 'Delivered package quantity',
        'status': 'pass' if delivery and delivery.quantity == delivered else 'review',
        'detail': f'Variable invoice {format_decimal(delivered)}; incentive invoice {format_decimal(delivery.quantity) if delivery else "missing"}.',
    })

    if pickup:
        eligible_at_rate = variable['pickup_packages_by_rate'].get(str(pickup.rate), Decimal(0))  # type: ignore[union-attr]
        status = 'pass' if pickup.quantity == eligible_at_rate else 'review'
        detail = (
            f'Variable invoice has {format_decimal(eligible_at_rate)} pickup package(s) at '
            f'${format_decimal(pickup.rate)}; incentive invoice pays {format_decimal(pickup.quantity)}.'
        )
    else:
        status = 'review'
        detail = 'Pickup incentive line is missing.'
    checks.append({'check': 'Pickup incentive quantity at matching rate', 'status': status, 'detail': detail})
    return checks


def compare_wst(wst: dict[str, object], variable: dict[str, object], incentive: dict[str, object]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    delivery: LineItem | None = incentive['delivery']  # type: ignore[assignment]
    pickup: LineItem | None = incentive['pickup']  # type: ignore[assignment]

    comparisons = [
        ('10-hour route blocks', wst.get('route_hours', {}).get('10', 0), variable['route_hours'].get('10', 0)),  # type: ignore[union-attr]
        ('9-hour route blocks', wst.get('route_hours', {}).get('9', 0), variable['route_hours'].get('9', 0)),  # type: ignore[union-attr]
        ('8-hour route blocks', wst.get('route_hours', {}).get('8', 0), variable['route_hours'].get('8', 0)),  # type: ignore[union-attr]
        ('10-hour ORE blocks', wst.get('experience_hours', {}).get('10', 0), variable['experience_hours'].get('10', 0)),  # type: ignore[union-attr]
        ('Training days', wst.get('training_days', 0), variable['training_days']),
        ('Eligible delivered packages', wst.get('delivered_packages', 0), delivery.quantity if delivery else 0),
        ('Eligible pickup packages', wst.get('pickup_packages_eligible', 0), pickup.quantity if pickup else 0),
    ]
    for label, our_value, amazon_value in comparisons:
        our_decimal = Decimal(str(our_value))
        amazon_decimal = Decimal(str(amazon_value))
        checks.append({
            'check': f'Our Data: {label}',
            'status': 'pass' if our_decimal == amazon_decimal else 'review',
            'detail': f'WST {format_decimal(our_decimal)}; Amazon invoice {format_decimal(amazon_decimal)}.',
        })
    return checks


def compare_wst_history(
    baseline: dict[str, object],
    current: dict[str, object],
    variable: dict[str, object],
) -> list[dict[str, object]]:
    checks: list[dict[str, object]] = []
    baseline_hours = baseline.get('route_hours', {})
    current_hours = current.get('route_hours', {})
    invoice_hours = variable.get('route_hours', {})
    hours_seen = sorted(
        {str(key) for key in baseline_hours} | {str(key) for key in current_hours} | {str(key) for key in invoice_hours},
        key=int,
        reverse=True,
    )
    for hours in hours_seen:
        before = Decimal(str(baseline_hours.get(hours, 0)))
        now = Decimal(str(current_hours.get(hours, 0)))
        invoiced = Decimal(str(invoice_hours.get(hours, 0)))
        if before == now:
            continue
        added = now - before
        recovered = added > 0 and invoiced == now
        checks.append({
            'check': f'WST snapshot change: {hours}-hour route blocks',
            'status': 'recovered' if recovered else 'review',
            'detail': (
                f'Baseline WST {format_decimal(before)}; current WST {format_decimal(now)}; '
                f'Amazon invoice {format_decimal(invoiced)}; change {format_decimal(added)}.'
            ),
            'direction': 'recovered_before_review' if recovered else 'wst_snapshot_changed',
            'recovered_routes': float(added) if recovered else 0,
        })
    return checks


def extract_recovery_outcomes(document: dict[str, object], *, year: int, week: int, source_path: str) -> list[dict[str, object]]:
    outcomes: list[dict[str, object]] = []
    week_pattern = re.compile(r'\bWK\s*0?(\d{1,2})\b', re.I)
    recovery_pattern = re.compile(
        r'added\s+(?P<routes>\d+)\s+routes?.{0,240}?recaptured.{0,120}?\$\s*(?P<amount>[\d,]+(?:\.\d{1,2})?)',
        re.I | re.S,
    )
    for message in document.get('messages', []):
        if not isinstance(message, dict):
            continue
        subject = str(message.get('subject') or '')
        week_match = week_pattern.search(subject)
        if not week_match or int(week_match.group(1)) != week:
            continue
        body = str(message.get('body') or '')
        match = recovery_pattern.search(body)
        if not match:
            continue
        message_date = str(message.get('date') or '')
        if message_date[:4].isdigit() and int(message_date[:4]) != year:
            continue
        outcomes.append({
            'type': 'reported_wst_recovery',
            'week': week,
            'routes_recovered': int(match.group('routes')),
            'amount_recovered': float(decimal_value(match.group('amount'))),
            'subject': subject,
            'message_id': message.get('messageId') or message.get('dedupeKey'),
            'message_date': message_date,
            'source_path': source_path,
        })
    return outcomes


def format_decimal(value: Decimal | object) -> str:
    if not isinstance(value, Decimal):
        return str(value)
    if value == value.to_integral():
        return f'{int(value):,}'
    return f'{value:,.2f}'


def json_value(value: object) -> object:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, LineItem):
        return {key: json_value(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_value(item) for item in value]
    return value


def build_report(
    variable_text: str,
    incentive_text: str,
    *,
    dsp: str,
    station: str,
    dispute_deadline: str | None,
    wst_summary: dict[str, object] | None = None,
    wst_baseline: dict[str, object] | None = None,
    external_outcomes: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    variable_items = parse_variable_items(variable_text)
    incentive_items = parse_incentive_items(incentive_text)
    if not variable_items or not incentive_items:
        raise ValueError('No invoice line items were parsed')
    try:
        week, year = find_week(incentive_text)
    except ValueError:
        week, year = find_week(variable_text)
    variable = summarize_variable(variable_items)
    incentive = summarize_incentive(incentive_items)
    total = find_total(incentive_text)
    checks = compare_counts(variable, incentive)
    if wst_summary:
        checks = compare_wst(wst_summary, variable, incentive) + checks
    if wst_summary and wst_baseline:
        checks = compare_wst_history(wst_baseline, wst_summary, variable) + checks
    external_outcomes = external_outcomes or []
    for outcome in external_outcomes:
        checks.insert(0, {
            'check': 'Reported WST recovery outcome',
            'status': 'recovered',
            'detail': (
                f"Outcome evidence confirms {outcome['routes_recovered']} route(s) added through a WST request; "
                f"${Decimal(str(outcome['amount_recovered'])):,.2f} recovered."
            ),
            'direction': 'recovered_before_review',
            'recovered_routes': outcome['routes_recovered'],
            'recovered_amount': outcome['amount_recovered'],
        })
    computed_total = sum((item.amount for item in incentive_items), Decimal(0))
    checks.append({
        'check': 'Incentive invoice arithmetic',
        'status': 'pass' if computed_total == total else 'review',
        'detail': f'Line items total ${format_decimal(computed_total)}; invoice total ${format_decimal(total)}.',
    })
    review_questions = [
        'Confirm each training day against the DA training roster/WST; invoice PDFs contain counts but not DA names.',
        'Compare daily route blocks with accepted ad hoc routes and WST before closing the review.',
        'If a count is wrong, retain the source PDF and supporting portal/WST evidence before filing a dispute.',
    ]
    if wst_summary:
        review_questions = [
            'Reconcile WST route execution and training events to the Scheduling roster and, once connected, ADP time records.',
            'Review suppressed work orders and excluded service types; do not silently count them as payable route blocks.',
            'If a count is wrong, retain the invoice, WST snapshot, Scheduling, and Operations evidence before filing a dispute.',
        ]
    return {
        'dsp': dsp,
        'station': station,
        'week': week,
        'year': year,
        'dispute_deadline': dispute_deadline,
        'variable': variable,
        'incentive': incentive,
        'incentive_total': total,
        'wst_summary': wst_summary,
        'wst_baseline': wst_baseline,
        'external_outcomes': external_outcomes,
        'checks': checks,
        'review_questions': review_questions,
    }


def render_markdown(report: dict[str, object]) -> str:
    variable = report['variable']
    incentive = report['incentive']
    delivery: LineItem | None = incentive['delivery']  # type: ignore[index,assignment]
    pickup: LineItem | None = incentive['pickup']  # type: ignore[index,assignment]
    route_hours = variable['route_hours']  # type: ignore[index]
    experience_hours = variable['experience_hours']  # type: ignore[index]
    deadline = report['dispute_deadline'] or 'Not supplied — verify in Amazon Payments'
    lines = [
        f"# {report['dsp']} - {report['station']} Week {report['week']} Invoice Reconciliation",
        '',
        f"**Dispute deadline:** {deadline}",
        '',
    ]
    if report.get('wst_summary'):
        wst = report['wst_summary']
        lines.extend([
            '## Our Data (Amazon Work Summary Tool)',
            '',
            '| Metric | WST value |',
            '|---|---:|',
            f"| 10-hour route blocks | {format_decimal(Decimal(str(wst.get('route_hours', {}).get('10', 0))))} |",
            f"| 9-hour route blocks | {format_decimal(Decimal(str(wst.get('route_hours', {}).get('9', 0))))} |",
            f"| 8-hour route blocks | {format_decimal(Decimal(str(wst.get('route_hours', {}).get('8', 0))))} |",
            f"| 10-hour ORE blocks | {format_decimal(Decimal(str(wst.get('experience_hours', {}).get('10', 0))))} |",
            f"| Eligible training events | {format_decimal(Decimal(str(wst.get('training_days', 0))))} |",
            f"| Eligible delivered packages | {format_decimal(Decimal(str(wst.get('delivered_packages', 0))))} |",
            f"| Eligible pickup packages | {format_decimal(Decimal(str(wst.get('pickup_packages_eligible', 0))))} |",
            f"| Suppressed work orders (excluded from route pay) | {format_decimal(Decimal(str(wst.get('suppressed_work_orders', 0))))} |",
            '',
        ])
    lines.extend([
        '## Amazon invoice snapshot',
        '',
        '| Metric | Reconciled value |',
        '|---|---:|',
    ])
    for hours in sorted(route_hours, key=int, reverse=True):
        lines.append(f'| {hours}-hour route blocks | {format_decimal(route_hours[hours])} |')
    for hours in sorted(experience_hours, key=int, reverse=True):
        lines.append(f'| {hours}-hour on-road experience blocks | {format_decimal(experience_hours[hours])} |')
    lines.extend([
        f"| Training days | {format_decimal(variable['training_days'])} |",
        f"| Delivered packages | {format_decimal(variable['delivered_packages'])} |",
        f"| Pickup packages (all variable rates) | {format_decimal(variable['pickup_packages'])} |",
        f"| Incentive rating | {incentive['rating']} |",
        f"| Delivery incentive | ${format_decimal(delivery.amount) if delivery else 'missing'} |",
        f"| Pickup incentive | ${format_decimal(pickup.amount) if pickup else 'missing'} |",
        f"| Incentive invoice total | ${format_decimal(report['incentive_total'])} |",
        '',
        '## Automated checks',
        '',
        '| Check | Status | Detail |',
        '|---|---|---|',
    ])
    for check in report['checks']:
        lines.append(f"| {check['check']} | {check['status'].upper()} | {check['detail']} |")
    lines.extend(['', '## Human verification queue', ''])
    lines.extend(f'- [ ] {question}' for question in report['review_questions'])
    lines.extend([
        '',
        '## Decision',
        '',
        '- The invoice arithmetic and rate-aware package comparisons are automated above.',
        '- Do not mark the invoice reviewed or submit a dispute until the human-verification queue is complete.',
    ])
    return '\n'.join(lines) + '\n'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Reconcile Amazon variable and incentive invoice PDFs.')
    parser.add_argument('--variable-pdf', required=True, type=Path)
    parser.add_argument('--incentive-pdf', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--dsp', default='JECS')
    parser.add_argument('--station', default='DFH7')
    parser.add_argument('--dispute-deadline')
    parser.add_argument('--wst-summary', type=Path, help='WST snapshot JSON generated by amazon_wst_snapshot.mjs')
    parser.add_argument('--wst-baseline', type=Path, help='Earlier immutable WST snapshot for before/after comparison')
    parser.add_argument('--outcome-email-json', type=Path, action='append', default=[], help='Archived mailbox JSON containing reconciliation outcome evidence')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    wst_summary = None
    wst_baseline = None
    if args.wst_summary:
        wst_document = json.loads(args.wst_summary.read_text(encoding='utf-8'))
        wst_summary = wst_document.get('summary', wst_document)
    if args.wst_baseline:
        baseline_document = json.loads(args.wst_baseline.read_text(encoding='utf-8'))
        wst_baseline = baseline_document.get('summary', baseline_document)
    variable_text = extract_pdf_text(args.variable_pdf)
    incentive_text = extract_pdf_text(args.incentive_pdf)
    try:
        outcome_week, outcome_year = find_week(incentive_text)
    except ValueError:
        outcome_week, outcome_year = find_week(variable_text)
    external_outcomes = []
    seen_outcomes = set()
    for email_path in args.outcome_email_json:
        document = json.loads(email_path.read_text(encoding='utf-8'))
        for outcome in extract_recovery_outcomes(document, year=outcome_year, week=outcome_week, source_path=str(email_path.resolve())):
            dedupe_key = outcome.get('message_id') or (outcome.get('subject'), outcome.get('message_date'))
            if dedupe_key in seen_outcomes:
                continue
            seen_outcomes.add(dedupe_key)
            external_outcomes.append(outcome)
    report = build_report(
        variable_text,
        incentive_text,
        dsp=args.dsp,
        station=args.station,
        dispute_deadline=args.dispute_deadline,
        wst_summary=wst_summary,
        wst_baseline=wst_baseline,
        external_outcomes=external_outcomes,
    )
    report['source_evidence'] = [
        source_fingerprint(args.variable_pdf, 'amazon_variable_invoice'),
        source_fingerprint(args.incentive_pdf, 'amazon_incentive_invoice'),
    ]
    if args.wst_summary:
        report['source_evidence'].append(source_fingerprint(args.wst_summary, 'amazon_wst_summary'))
    if args.wst_baseline:
        report['source_evidence'].append(source_fingerprint(args.wst_baseline, 'amazon_wst_baseline'))
    used_outcome_paths = {str(item['source_path']) for item in external_outcomes}
    for email_path in args.outcome_email_json:
        if str(email_path.resolve()) in used_outcome_paths:
            report['source_evidence'].append(source_fingerprint(email_path, 'reconciliation_outcome_email_archive'))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"week{report['week']}-invoice-reconciliation"
    markdown_path = args.output_dir / f'{stem}.md'
    json_path = args.output_dir / f'{stem}.json'
    markdown_path.write_text(render_markdown(report), encoding='utf-8')
    json_path.write_text(json.dumps(json_value(report), indent=2) + '\n', encoding='utf-8')
    print(markdown_path)
    print(json_path)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
