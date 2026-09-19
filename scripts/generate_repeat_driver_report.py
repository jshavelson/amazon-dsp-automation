#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from evaluate_week import ROOT, find_one, infer_week_parts, read_csv_rows, render_markdown_pdf, require_file, to_float, to_int

WINDOW_SIZE = 6
OUTPUT_DIR = ROOT / 'data' / 'scorecard_data' / 'repeat-driver-data'
MASTER_MD = OUTPUT_DIR / 'master-repeat-driver-report.md'
MASTER_PDF = OUTPUT_DIR / 'master-repeat-driver-report.pdf'
IMPACT_BASE_WEIGHTS = {
    'issue_weeks': 5,
    'total_severity': 2,
    'latest_severity': 3,
    'latest_issue_bonus': 5,
}
IMPACT_METRIC_WEIGHTS = {
    'cdf': 3,
    'dcr': 3,
    'dsb': 2,
    'safety': 2,
    'pod': 1,
    'score': 1,
}


def usage() -> None:
    print('Usage: generate_repeat_driver_report.py <week-folder> [--render-pdf true|false]', file=sys.stderr)


def week_output_paths(week_folder: Path) -> tuple[Path, Path, str]:
    _, _, week_label, week_num = infer_week_parts(week_folder)
    md_path = week_folder / f'week{week_num}-repeat-driver-report.md'
    pdf_path = week_folder / f'week{week_num}-repeat-driver-report.pdf'
    return md_path, pdf_path, f'Week {week_num} Repeat Driver Report ({week_label})'


def top10_output_paths(week_folder: Path) -> tuple[Path, Path, str]:
    _, _, week_label, week_num = infer_week_parts(week_folder)
    md_path = week_folder / f'week{week_num}-top10-repeat-driver-report.md'
    pdf_path = week_folder / f'week{week_num}-top10-repeat-driver-report.pdf'
    return md_path, pdf_path, f'Week {week_num} Top 10 Repeat Driver Report ({week_label})'


def parse_args(argv: list[str]) -> tuple[Path, dict[str, str | bool]]:
    if len(argv) < 2:
        usage()
        raise SystemExit(1)
    week_folder = Path(argv[1]).resolve()
    args: dict[str, str | bool] = {}
    i = 2
    while i < len(argv):
        key = argv[i]
        if not key.startswith('--'):
            raise SystemExit(f'Unexpected argument: {key}')
        value: str | bool = True
        if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
            value = argv[i + 1]
            i += 1
        args[key[2:]] = value
        i += 1
    return week_folder, args


def parse_bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() == 'true'


def week_sort_key(path: Path) -> tuple[int, int]:
    year, week_number, _, _ = infer_week_parts(path)
    return year, week_number


def normalize_percentish(value: float | None) -> float | None:
    if value is None:
        return None
    return value * 100 if value <= 1.5 else value


def valid_transporter_id(value: str) -> bool:
    text = value.strip()
    return bool(text) and text.upper() != 'PASSENGER'


def discover_recent_weeks(reference_week_folder: Path, window_size: int = WINDOW_SIZE) -> list[Path]:
    parent = reference_week_folder.parent
    candidates = []
    for path in parent.iterdir():
        if not path.is_dir():
            continue
        try:
            infer_week_parts(path)
        except ValueError:
            continue
        if find_one(path, 'DSP_Overview_Dashboard') is None:
            continue
        candidates.append(path)
    candidates.sort(key=week_sort_key)
    if reference_week_folder not in candidates:
        raise FileNotFoundError(f'{reference_week_folder.name} is not a processed scorecard week folder')
    ref_idx = candidates.index(reference_week_folder)
    start_idx = max(0, ref_idx - window_size + 1)
    return candidates[start_idx:ref_idx + 1]


def status_text(metrics: dict[str, object] | None) -> str:
    if not metrics or not metrics.get('present'):
        return '—'
    issues = metrics.get('issues', [])
    if not issues:
        return 'Clean'
    parts: list[str] = []
    if 'cdf' in issues:
        neg = metrics.get('negative_feedback', 0)
        dpmo = metrics.get('cdf_dpmo')
        parts.append(f'CDF {int(dpmo) if dpmo is not None else neg}')
    if 'dsb' in issues:
        parts.append(f"DSB {metrics.get('dsb_count', 0)}")
    if 'dcr' in issues:
        dcr = metrics.get('dcr_rate')
        parts.append(f"DCR {dcr:.2f}%" if isinstance(dcr, float) else 'DCR')
    if 'pod' in issues:
        pod = metrics.get('pod_rate')
        parts.append(f"POD {pod:.1f}%" if isinstance(pod, float) else 'POD')
    if 'score' in issues:
        score = metrics.get('overall_score')
        parts.append(f"Score {score:.1f}" if isinstance(score, float) else 'Low score')
    if 'safety' in issues:
        parts.append(f"Safety {metrics.get('safety_events', 0)}")
    return ', '.join(parts)


def severity_for_week(metrics: dict[str, object]) -> int:
    score = 0
    issues = set(metrics.get('issues', []))
    if 'cdf' in issues:
        score += 2
        if (metrics.get('cdf_dpmo') or 0) >= 3000 or (metrics.get('negative_feedback') or 0) >= 3:
            score += 1
    if 'dsb' in issues:
        score += 2
        if (metrics.get('dsb_count') or 0) >= 2:
            score += 1
    if 'dcr' in issues:
        score += 2
        if (metrics.get('controllable_rts') or 0) >= 5 or ((metrics.get('dcr_rate') or 100) < 98.5):
            score += 1
    if 'pod' in issues:
        score += 1
        if ((metrics.get('pod_rate') or 100) < 98.0):
            score += 1
    if 'score' in issues:
        score += 1
        if ((metrics.get('overall_score') or 100) < 85.0):
            score += 1
    if 'safety' in issues:
        score += 1
        if (metrics.get('safety_events') or 0) >= 2:
            score += 1
    return score


def extract_week_driver_metrics(week_folder: Path) -> dict[str, object]:
    _, _, week_label, _ = infer_week_parts(week_folder)
    overview_rows = read_csv_rows(require_file(week_folder, 'DSP_Overview_Dashboard'))
    dcr_rows = read_csv_rows(require_file(week_folder, 'Quality_DCR'))
    dsb_rows = read_csv_rows(require_file(week_folder, 'Quality_DSB_DNR'))
    pod_rows = read_csv_rows(require_file(week_folder, 'Quality_POD'))
    cdf_rows = read_csv_rows(require_file(week_folder, 'Quality_CDF'))
    safety_path = find_one(week_folder, 'Safety_Dashboard')
    safety_rows = read_csv_rows(safety_path) if safety_path else []

    drivers: dict[str, dict[str, object]] = {}

    def ensure_driver(transporter_id: str, name: str = '') -> dict[str, object]:
        entry = drivers.setdefault(transporter_id, {
            'name': name or transporter_id,
            'transporter_id': transporter_id,
            'present': True,
            'overall_score': None,
            'packages_delivered': 0,
            'cdf_dpmo': None,
            'negative_feedback': 0,
            'dsb_count': 0,
            'dcr_rate': None,
            'controllable_rts': 0,
            'pod_rate': None,
            'pod_opportunities': 0,
            'safety_events': 0,
            'issues': [],
        })
        if name and (not entry.get('name') or entry.get('name') == transporter_id):
            entry['name'] = name
        return entry

    for row in overview_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        if not valid_transporter_id(transporter_id):
            continue
        entry = ensure_driver(transporter_id, (row.get('Delivery Associate ') or '').strip())
        entry['overall_score'] = to_float(row.get('Overall Score'))
        entry['packages_delivered'] = to_int(row.get('Packages Delivered'))

    for row in cdf_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        if not valid_transporter_id(transporter_id):
            continue
        entry = ensure_driver(transporter_id, (row.get('Delivery Associate ') or '').strip())
        entry['cdf_dpmo'] = to_float(row.get('CDF DPMO'))
        entry['negative_feedback'] = to_int(row.get('Negative Feedback Count'))

    for row in dsb_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        if not valid_transporter_id(transporter_id):
            continue
        entry = ensure_driver(transporter_id, (row.get('Delivery Associate ') or '').strip())
        entry['dsb_count'] = to_int(row.get('DSB Count'))

    for row in dcr_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        if not valid_transporter_id(transporter_id):
            continue
        entry = ensure_driver(transporter_id, (row.get('Delivery Associate ') or '').strip())
        entry['dcr_rate'] = to_float(row.get('DCR'))
        entry['controllable_rts'] = to_int(row.get('Packages Returned to Station - DA Controllable'))

    for row in pod_rows:
        transporter_id = (row.get('Transporter ID') or '').strip()
        if not valid_transporter_id(transporter_id):
            continue
        entry = ensure_driver(transporter_id, (row.get('Delivery Associate ') or '').strip())
        entry['pod_rate'] = normalize_percentish(to_float(row.get('SWC - Photo on Delivery')))
        entry['pod_opportunities'] = to_int(row.get('POD Opportunities'))

    safety_counter = Counter(
        (row.get('Transporter ID') or '').strip()
        for row in safety_rows
        if valid_transporter_id((row.get('Transporter ID') or '').strip())
    )
    for transporter_id, count in safety_counter.items():
        entry = ensure_driver(transporter_id)
        entry['safety_events'] = count

    for entry in drivers.values():
        issues: list[str] = []
        if ((entry.get('negative_feedback') or 0) >= 2) or ((entry.get('cdf_dpmo') or 0) >= 1500):
            issues.append('cdf')
        if (entry.get('dsb_count') or 0) >= 1:
            issues.append('dsb')
        dcr_rate = entry.get('dcr_rate')
        if (entry.get('controllable_rts') or 0) >= 3 or (isinstance(dcr_rate, float) and dcr_rate < 99.5):
            issues.append('dcr')
        pod_rate = entry.get('pod_rate')
        pod_opportunities = entry.get('pod_opportunities') or 0
        if isinstance(pod_rate, float) and ((pod_rate < 99.0 and pod_opportunities >= 100) or (pod_rate < 98.5 and pod_opportunities >= 50)):
            issues.append('pod')
        overall_score = entry.get('overall_score')
        if isinstance(overall_score, float) and overall_score < 90.0:
            issues.append('score')
        if (entry.get('safety_events') or 0) >= 1:
            issues.append('safety')
        entry['issues'] = issues
        entry['severity'] = severity_for_week(entry)

    return {
        'week_label': week_label,
        'week_folder': week_folder,
        'drivers': drivers,
    }


def build_driver_rollup(week_data: list[dict[str, object]]) -> tuple[list[str], dict[str, dict[str, object]]]:
    week_labels = [item['week_label'] for item in week_data]
    history: dict[str, dict[str, object]] = {}
    latest_label = week_labels[-1]
    previous_labels = week_labels[:-1]

    for week in week_data:
        week_label = week['week_label']
        for transporter_id, metrics in week['drivers'].items():
            entry = history.setdefault(transporter_id, {
                'name': metrics['name'],
                'transporter_id': transporter_id,
                'weeks': {},
                'issue_counts': Counter(),
                'issue_weeks': 0,
                'total_severity': 0,
                'latest_issue': False,
                'latest_severity': 0,
            })
            entry['name'] = metrics.get('name') or entry['name']
            entry['weeks'][week_label] = metrics
            if metrics.get('issues'):
                entry['issue_weeks'] += 1
                entry['total_severity'] += int(metrics.get('severity') or 0)
                for issue in metrics['issues']:
                    entry['issue_counts'][issue] += 1
            if week_label == latest_label:
                entry['latest_issue'] = bool(metrics.get('issues'))
                entry['latest_severity'] = int(metrics.get('severity') or 0)

    filtered: dict[str, dict[str, object]] = {}
    for transporter_id, entry in history.items():
        weeks = entry['weeks']
        prior_issue_weeks = sum(1 for label in previous_labels if weeks.get(label, {}).get('issues'))
        latest_metrics = weeks.get(latest_label, {'issues': [], 'severity': 0})
        latest_issue = bool(latest_metrics.get('issues'))
        if entry['issue_weeks'] < 2 and not (latest_issue and int(latest_metrics.get('severity') or 0) >= 4):
            continue
        prior_severities = [int((weeks.get(label) or {}).get('severity') or 0) for label in previous_labels if weeks.get(label, {}).get('issues')]
        latest_severity = int(latest_metrics.get('severity') or 0)
        if latest_issue and prior_severities:
            avg_prior = sum(prior_severities) / len(prior_severities)
            if latest_severity >= avg_prior + 1:
                trend = 'worsening'
            elif latest_severity <= avg_prior - 1:
                trend = 'improving'
            else:
                trend = 'flat'
        elif latest_issue and not prior_severities:
            trend = 'new'
        elif not latest_issue and prior_issue_weeks >= 2:
            trend = 'improving'
        else:
            trend = 'flat'
        dominant_issue = entry['issue_counts'].most_common(1)[0][0] if entry['issue_counts'] else 'mixed'
        route_review = entry['issue_counts'].get('dcr', 0) >= max(2, entry['issue_counts'].get('cdf', 0) + entry['issue_counts'].get('dsb', 0))
        if entry['issue_weeks'] >= 3 and (latest_issue or entry['total_severity'] >= 8):
            tier = 1
        elif entry['issue_weeks'] >= 2 and (latest_issue or entry['total_severity'] >= 5):
            tier = 2
        else:
            tier = 3
        entry['prior_issue_weeks'] = prior_issue_weeks
        entry['trend'] = trend
        entry['dominant_issue'] = dominant_issue
        entry['route_review'] = route_review
        entry['tier'] = tier
        filtered[transporter_id] = entry
    return week_labels, filtered


def sort_driver_entries(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(
        entries,
        key=lambda item: (
            item['tier'],
            -int(item['issue_weeks']),
            -int(item['latest_issue']),
            -int(item['latest_severity']),
            -int(item['total_severity']),
            str(item['name']).lower(),
        ),
    )


def issue_phrase(issue_counts: Counter[str]) -> str:
    labels = {
        'cdf': 'CDF/customer feedback',
        'dsb': 'DSB scan-quality',
        'dcr': 'DCR/RTS',
        'pod': 'POD',
        'score': 'overall score',
        'safety': 'safety',
    }
    ordered = [f"{labels[key]} ({count})" for key, count in issue_counts.most_common() if count > 0]
    return ', '.join(ordered) if ordered else 'No repeated issue clusters recorded'


def impact_score(entry: dict[str, object]) -> int:
    issue_counts: Counter[str] = entry['issue_counts']
    metric_weight = sum(
        issue_counts.get(metric, 0) * weight
        for metric, weight in IMPACT_METRIC_WEIGHTS.items()
    )
    return (
        int(entry['issue_weeks']) * IMPACT_BASE_WEIGHTS['issue_weeks']
        + int(entry['total_severity']) * IMPACT_BASE_WEIGHTS['total_severity']
        + int(entry['latest_severity']) * IMPACT_BASE_WEIGHTS['latest_severity']
        + (IMPACT_BASE_WEIGHTS['latest_issue_bonus'] if entry['latest_issue'] else 0)
        + metric_weight
    )


def latest_summary(metrics: dict[str, object] | None, week_label: str) -> str:
    if not metrics or not metrics.get('present'):
        return f'{week_label}: not active in dataset'
    parts: list[str] = []
    score = metrics.get('overall_score')
    if isinstance(score, float):
        parts.append(f'Overall {score:.2f}')
    cdf = metrics.get('cdf_dpmo')
    neg = metrics.get('negative_feedback')
    if cdf or neg:
        cdf_text = f'CDF {int(cdf)}' if isinstance(cdf, float) else f'CDF complaints {neg}'
        if neg:
            cdf_text += f' / {neg} complaints'
        parts.append(cdf_text)
    dsb = metrics.get('dsb_count') or 0
    if dsb:
        parts.append(f'DSB {dsb}')
    dcr = metrics.get('dcr_rate')
    controllable = metrics.get('controllable_rts') or 0
    if isinstance(dcr, float):
        dcr_text = f'DCR {dcr:.2f}%'
        if controllable:
            dcr_text += f' / {controllable} controllable RTS'
        parts.append(dcr_text)
    pod = metrics.get('pod_rate')
    if isinstance(pod, float):
        parts.append(f'POD {pod:.2f}%')
    safety = metrics.get('safety_events') or 0
    if safety:
        parts.append(f'Safety {safety}')
    return f"{week_label}: " + ', '.join(parts) if parts else f'{week_label}: active with no major issue flags'


def compact_week_label(week_label: str) -> str:
    return week_label.replace('2026-', '').replace('2025-', '').replace('2024-', '')


def compact_status_text(metrics: dict[str, object] | None) -> str:
    if not metrics or not metrics.get('present'):
        return '—'
    issues = metrics.get('issues', [])
    if not issues:
        return 'OK'
    codes = {
        'cdf': 'C',
        'dsb': 'S',
        'dcr': 'R',
        'pod': 'P',
        'score': 'O',
        'safety': 'F',
    }
    return '/'.join(codes[issue] for issue in issues if issue in codes)


def assessment_text(entry: dict[str, object], latest_label: str) -> str:
    trend = entry['trend']
    latest_metrics = entry['weeks'].get(latest_label)
    latest_issue = bool(latest_metrics and latest_metrics.get('issues'))
    if entry['route_review']:
        base = 'Repeat profile leans toward route/building/process review more than pure driver-behavior coaching.'
    elif entry['dominant_issue'] == 'cdf':
        base = 'Repeat customer-experience leakage remains the clearest problem pattern.'
    elif entry['dominant_issue'] == 'dsb':
        base = 'Repeated scan-quality / completion defects keep this driver on the active coaching list.'
    elif entry['dominant_issue'] == 'pod':
        base = 'Recurring delivery-confirmation execution still needs coaching.'
    elif entry['dominant_issue'] == 'safety':
        base = 'Safety recurrence keeps this driver in an elevated review lane.'
    else:
        base = 'Mixed repeat pattern across multiple metrics.'

    if trend == 'improving' and not latest_issue:
        return base + ' Latest week improved, but the rolling history is still too strong to fully clear.'
    if trend == 'worsening':
        return base + ' The latest week is worse than the prior rolling baseline.'
    if trend == 'new':
        return base + ' This is a new high-severity addition rather than a long-window chronic name.'
    return base


def build_markdown(week_labels: list[str], rollup: dict[str, dict[str, object]], title: str) -> str:
    latest_label = week_labels[-1]
    ordered = sort_driver_entries(list(rollup.values()))
    tier1 = [entry for entry in ordered if entry['tier'] == 1]
    tier2 = [entry for entry in ordered if entry['tier'] == 2]
    tier3 = [entry for entry in ordered if entry['tier'] == 3]
    chronic = [entry['name'] for entry in ordered if entry['issue_weeks'] >= 3][:8]
    current_additions = [
        entry['name'] for entry in ordered
        if entry['latest_issue'] and entry['prior_issue_weeks'] == 0
    ][:5]
    improvements = [
        entry['name'] for entry in ordered
        if not entry['latest_issue'] and entry['prior_issue_weeks'] >= 2
    ][:5]

    lines: list[str] = []
    lines.append(f'# {title}')
    lines.append('')
    lines.append('## Executive Summary')
    lines.append(f'This is the rolling repeat-driver review for the last **{len(week_labels)}** processed scorecards. Current window: ' + ', '.join(week_labels) + '.')
    lines.append('')
    lines.append(f'- **Tier 1 active repeat names:** {len(tier1)}')
    lines.append(f'- **Tier 2 mixed repeat names:** {len(tier2)}')
    lines.append(f'- **Tier 3 watchlist names:** {len(tier3)}')
    lines.append(f'- **Strongest chronic names now:** {", ".join(chronic) if chronic else "None yet"}')
    lines.append(f'- **Biggest new additions in {latest_label}:** {", ".join(current_additions) if current_additions else "None"}')
    lines.append(f'- **Best recent improvements:** {", ".join(improvements) if improvements else "None"}')
    lines.append('')
    lines.append('## Weeks Included')
    for label in week_labels:
        lines.append(f'- {label}')
    lines.append('')

    section_map = [
        ('## Tier 1: Chronic repeat problems, active management required', tier1),
        ('## Tier 2: Mixed repeat problems, review with context', tier2),
        ('## Tier 3: Watchlist / emerging repeat names', tier3),
    ]
    for heading, entries in section_map:
        lines.append(heading)
        lines.append('')
        if not entries:
            lines.append('- None in this tier for the current rolling window.')
            lines.append('')
            continue
        for entry in entries:
            lines.append(f"### {entry['name']}")
            lines.append(f"- **Transporter ID:** {entry['transporter_id']}")
            lines.append(f"- **Rolling pattern:** {entry['issue_weeks']}/{len(week_labels)} issue weeks | {issue_phrase(entry['issue_counts'])}")
            lines.append(f"- **Latest week:** {latest_summary(entry['weeks'].get(latest_label), latest_label)}")
            lines.append(f"- **Assessment:** {assessment_text(entry, latest_label)}")
            lines.append('')

    lines.append('## Driver-by-Driver Comparison Matrix')
    lines.append('')
    lines.append('Issue-code legend: **C**=CDF, **S**=DSB/scan quality, **R**=DCR/RTS, **P**=POD, **O**=low overall score, **F**=safety, **OK**=no flagged repeat issue that week.')
    lines.append('')
    for entry in ordered:
        week_reads = [
            f"{compact_week_label(label)} {compact_status_text(entry['weeks'].get(label))}"
            for label in week_labels
        ]
        lines.append(f"- **{entry['name']}** ({entry['transporter_id']}): " + ' | '.join(week_reads) + f" | Trend {str(entry['trend']).title()}")
    lines.append('')

    coaching_names = [entry['name'] for entry in ordered if not entry['route_review'] and entry['tier'] <= 2][:8]
    route_review_names = [entry['name'] for entry in ordered if entry['route_review']][:8]
    improved_names = [entry['name'] for entry in ordered if entry['trend'] == 'improving'][:8]

    lines.append('## Recommended Actions')
    lines.append('')
    lines.append('### Coaching-first chronic names')
    for name in coaching_names or ['None beyond normal weekly coaching']:
        lines.append(f'- {name}')
    lines.append('')
    lines.append('### Mixed root-cause / route-review names')
    for name in route_review_names or ['None identified as route/process-dominant in this window']:
        lines.append(f'- {name}')
    lines.append('')
    lines.append('### Improved, but keep on the rolling watchlist')
    for name in improved_names or ['None']:
        lines.append(f'- {name}')
    lines.append('')
    lines.append('## Notes / Caveats')
    lines.append('- This report uses the last 6 processed weeks available up to the requested week, not just the latest week in isolation.')
    lines.append('- Repeat appearance does not always mean repeat driver fault; DCR-heavy names can be route/building/access/process driven.')
    lines.append('- Thresholds used here are intentionally practical for operations: elevated CDF, any DSB defect, controllable DCR pressure, low POD, low overall score, and safety recurrence.')
    lines.append('')
    lines.append('## Bottom Line')
    lines.append('Use this master report to separate true chronic names from one-week noise. Coach the chronic customer-quality / scan-quality names first, review DCR-heavy names for route and process causes before over-coaching, and keep the rolling watchlist updated every week.')
    lines.append('')
    return '\n'.join(lines)


def build_top10_markdown(week_labels: list[str], rollup: dict[str, dict[str, object]], title: str) -> str:
    latest_label = week_labels[-1]
    ordered = sorted(
        rollup.values(),
        key=lambda entry: (
            -impact_score(entry),
            entry['tier'],
            -int(entry['issue_weeks']),
            -int(entry['latest_severity']),
            -int(entry['total_severity']),
            str(entry['name']).lower(),
        ),
    )
    top10 = ordered[:10]

    lines: list[str] = []
    lines.append(f'# {title}')
    lines.append('')
    lines.append('## Ranking Method')
    lines.append('This weekly top-10 list ranks repeat drivers by rolling scorecard impact: repeat frequency, total severity across the rolling window, latest-week severity, and recurrence in the highest-leverage scorecard metrics (CDF, DCR/RTS, DSB, safety, POD, and low overall score).')
    lines.append('')
    lines.append(f'Rolling window used: {", ".join(week_labels)}')
    lines.append('')
    lines.append('## Top 10 Repeat Drivers Affecting the Scorecard')
    lines.append('')
    for idx, entry in enumerate(top10, start=1):
        latest_metrics = entry['weeks'].get(latest_label)
        lines.append(f'### {idx}) {entry["name"]}')
        lines.append(f'- **Transporter ID:** {entry["transporter_id"]}')
        lines.append(f'- **Impact score:** {impact_score(entry)}')
        lines.append(f'- **Tier / trend:** Tier {entry["tier"]} / {str(entry["trend"]).title()}')
        lines.append(f'- **Rolling pattern:** {entry["issue_weeks"]}/{len(week_labels)} issue weeks | {issue_phrase(entry["issue_counts"])}')
        lines.append(f'- **Latest week read:** {latest_summary(latest_metrics, latest_label)}')
        lines.append(f'- **Why this driver matters:** {assessment_text(entry, latest_label)}')
        action = 'Review route/building/process causes before making this only a coaching conversation.' if entry['route_review'] else 'Keep this name in direct coaching, ride-alongs, and weekly quality follow-up.'
        lines.append(f'- **Recommended action:** {action}')
        lines.append('')

    lines.append('## Bottom Line')
    if top10:
        names = ', '.join(entry['name'] for entry in top10[:5])
        lines.append(f'These are the 10 repeat names creating the heaviest rolling drag on the scorecard right now. Start with **{names}**, split route/process-heavy DCR names from pure coaching cases, and use this list as the weekly owner review queue.')
    else:
        lines.append('No repeat-driver names met the top-10 threshold in this rolling window.')
    lines.append('')
    return '\n'.join(lines)


def render_pdf(md_path: Path, pdf_path: Path, title: str) -> None:
    render_markdown_pdf(md_path, pdf_path)


def main() -> int:
    week_folder, args = parse_args(sys.argv)
    render = parse_bool(args.get('render-pdf'), True)
    if not week_folder.is_dir():
        print(f'Week folder not found: {week_folder}', file=sys.stderr)
        return 1
    weeks = discover_recent_weeks(week_folder)
    if len(weeks) < 2:
        print('Need at least two processed weeks to build a repeat-driver report.', file=sys.stderr)
        return 1
    week_data = [extract_week_driver_metrics(path) for path in weeks]
    week_labels, rollup = build_driver_rollup(week_data)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    master_title = 'Master Repeat Driver Report'
    master_markdown = build_markdown(week_labels, rollup, master_title)
    MASTER_MD.write_text(master_markdown, encoding='utf-8')
    print(f'Wrote {MASTER_MD}')

    week_md, week_pdf, week_title = week_output_paths(week_folder)
    week_markdown = build_markdown(week_labels, rollup, week_title)
    week_md.write_text(week_markdown, encoding='utf-8')
    print(f'Wrote {week_md}')

    top10_md, top10_pdf, top10_title = top10_output_paths(week_folder)
    top10_markdown = build_top10_markdown(week_labels, rollup, top10_title)
    top10_md.write_text(top10_markdown, encoding='utf-8')
    print(f'Wrote {top10_md}')

    if render:
        render_pdf(MASTER_MD, MASTER_PDF, master_title)
        print(f'Rendered {MASTER_PDF}')
        render_pdf(week_md, week_pdf, week_title)
        print(f'Rendered {week_pdf}')
        render_pdf(top10_md, top10_pdf, top10_title)
        print(f'Rendered {top10_pdf}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
