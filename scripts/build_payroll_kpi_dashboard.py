#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
from datetime import datetime, timezone
from pathlib import Path


CATEGORY_LABELS = {
    "regular": "Regular",
    "overtime": "Overtime",
    "bonus_hours": "Bonus hours",
    "bonus": "Bonus",
    "leave": "Leave",
    "pto": "PTO",
    "training": "Training",
}
COLORS = {
    "regular": "#2563eb",
    "overtime": "#f97316",
    "bonus_hours": "#8b5cf6",
    "bonus": "#d946ef",
    "leave": "#ef4444",
    "pto": "#14b8a6",
    "training": "#22c55e",
}


def money(value: float) -> str:
    return f"${value:,.2f}"


def number(value: float) -> str:
    return f"{value:,.2f}"


def stacked_bar(items: list[tuple[str, float]], total: float) -> str:
    parts = []
    for key, value in items:
        width = 0 if total == 0 else value / total * 100
        if width <= 0:
            continue
        parts.append(
            f'<span class="stack-segment" style="width:{width:.4f}%;background:{COLORS[key]}" '
            f'title="{html.escape(CATEGORY_LABELS[key])}: {value:,.2f}"></span>'
        )
    return "".join(parts)


def bar_rows(items: list[tuple[str, float]], value_formatter) -> str:
    maximum = max((value for _, value in items), default=0)
    rows = []
    for key, value in items:
        width = 0 if maximum == 0 else value / maximum * 100
        rows.append(
            '<div class="bar-row">'
            f'<div class="bar-label">{html.escape(CATEGORY_LABELS[key])}</div>'
            '<div class="bar-track">'
            f'<div class="bar-fill" style="width:{width:.4f}%;background:{COLORS[key]}"></div>'
            '</div>'
            f'<div class="bar-value">{html.escape(value_formatter(value))}</div>'
            '</div>'
        )
    return "".join(rows)


def donut(percent: float, color: str, center: str, label: str) -> str:
    bounded = max(0.0, min(100.0, percent))
    return f'''
    <div class="donut-wrap">
      <div class="donut" style="--pct:{bounded:.4f};--color:{color}">
        <div class="donut-center"><strong>{html.escape(center)}</strong><span>{html.escape(label)}</span></div>
      </div>
    </div>'''


def build_dashboard(summary: dict[str, object]) -> str:
    hours = {key: float(value) for key, value in summary["hours"].items()}
    earnings = {key: float(value) for key, value in summary["earnings"].items()}
    employees = int(summary["employee_count"])
    employees_with_ot = int(summary["employees_with_overtime"])
    ot_employee_pct = 0 if employees == 0 else employees_with_ot / employees * 100
    total_hours = sum(hours.values())
    total_earnings = sum(earnings.values())
    regular_ot_hours = hours.get("regular", 0) + hours.get("overtime", 0)
    regular_ot_pay = earnings.get("regular", 0) + earnings.get("overtime", 0)
    ot_hours_total_pct = 0 if regular_ot_hours == 0 else hours.get("overtime", 0) / regular_ot_hours * 100
    ot_pay_total_pct = 0 if regular_ot_pay == 0 else earnings.get("overtime", 0) / regular_ot_pay * 100
    hours_items = [(key, hours.get(key, 0)) for key in CATEGORY_LABELS]
    earnings_items = [(key, earnings.get(key, 0)) for key in CATEGORY_LABELS]
    nonzero_hours = [(key, value) for key, value in hours_items if value > 0]
    nonzero_earnings = [(key, value) for key, value in earnings_items if value > 0]
    period = summary["pay_period"]
    period_label = f'{period["start_date"]} to {period["end_date"]}'
    avg_hours = 0 if employees == 0 else total_hours / employees
    avg_earnings = 0 if employees == 0 else total_earnings / employees
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    source_file = html.escape(str(summary.get("source_filename", "Aggregate payroll register")))

    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payroll KPI Dashboard</title>
  <style>
    :root {{ color-scheme: dark; --bg:#07111f; --panel:#0e1b2d; --panel2:#12233a; --text:#e8eef8; --muted:#90a3bd; --line:#243750; --blue:#2563eb; --orange:#f97316; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:radial-gradient(circle at top right,#122f54 0,#07111f 38%); color:var(--text); }}
    .shell {{ max-width:1440px; margin:auto; padding:28px; }}
    header {{ display:flex; justify-content:space-between; gap:24px; align-items:flex-end; margin-bottom:20px; }}
    h1 {{ font-size:29px; margin:0 0 5px; letter-spacing:-.03em; }}
    h2 {{ font-size:17px; margin:0; }}
    .subtitle,.meta,.chart-note {{ color:var(--muted); }}
    .meta {{ text-align:right; font-size:12px; }}
    .kpis {{ display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:12px; }}
    .card {{ background:linear-gradient(180deg,rgba(18,35,58,.98),rgba(11,25,43,.98)); border:1px solid var(--line); border-radius:15px; box-shadow:0 12px 35px rgba(0,0,0,.15); }}
    .kpi {{ padding:17px; min-height:112px; }}
    .kpi-label {{ color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }}
    .kpi-value {{ font-size:25px; font-weight:750; margin:8px 0 3px; letter-spacing:-.025em; }}
    .kpi-detail {{ color:var(--muted); font-size:12px; }}
    .accent {{ color:#ffad72; }}
    .grid {{ display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:12px; }}
    .chart-card {{ padding:19px; min-height:280px; }}
    .span-4 {{ grid-column:span 4; }} .span-6 {{ grid-column:span 6; }} .span-8 {{ grid-column:span 8; }} .span-12 {{ grid-column:span 12; }}
    .chart-head {{ display:flex; justify-content:space-between; gap:16px; align-items:baseline; margin-bottom:18px; }}
    .chart-note {{ font-size:12px; }}
    .donut-wrap {{ display:grid; place-items:center; height:190px; }}
    .donut {{ --pct:0; --color:var(--orange); width:170px; aspect-ratio:1; border-radius:50%; background:conic-gradient(var(--color) calc(var(--pct)*1%),#21344c 0); display:grid; place-items:center; position:relative; }}
    .donut::after {{ content:""; position:absolute; inset:18px; border-radius:50%; background:var(--panel); box-shadow:inset 0 0 0 1px var(--line); }}
    .donut-center {{ z-index:1; display:flex; flex-direction:column; text-align:center; }}
    .donut-center strong {{ font-size:27px; }} .donut-center span {{ color:var(--muted); font-size:12px; }}
    .stack {{ height:30px; display:flex; overflow:hidden; border-radius:8px; background:#21344c; margin:22px 0 14px; }}
    .stack-segment {{ min-width:2px; }}
    .legend {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px 14px; }}
    .legend-item {{ display:flex; justify-content:space-between; gap:12px; color:var(--muted); font-size:12px; }}
    .legend-name {{ display:flex; gap:7px; align-items:center; }}
    .dot {{ width:8px; height:8px; border-radius:50%; flex:0 0 auto; }}
    .bar-row {{ display:grid; grid-template-columns:95px 1fr 82px; gap:10px; align-items:center; margin:12px 0; }}
    .bar-label,.bar-value {{ font-size:12px; color:var(--muted); }} .bar-value {{ text-align:right; color:var(--text); font-variant-numeric:tabular-nums; }}
    .bar-track {{ height:12px; border-radius:999px; background:#21344c; overflow:hidden; }} .bar-fill {{ height:100%; border-radius:999px; }}
    .actions {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
    .action {{ padding:15px; border:1px solid var(--line); border-radius:12px; background:rgba(7,17,31,.42); }}
    .action strong {{ display:block; margin-bottom:4px; }} .action p {{ margin:0; color:var(--muted); font-size:12px; }}
    footer {{ margin-top:15px; color:var(--muted); font-size:11px; display:flex; justify-content:space-between; gap:16px; }}
    @media (max-width:1100px) {{ .kpis {{ grid-template-columns:repeat(3,1fr); }} .span-4,.span-8 {{ grid-column:span 6; }} }}
    @media (max-width:720px) {{ .shell {{ padding:16px; }} header {{ display:block; }} .meta {{ text-align:left; margin-top:8px; }} .kpis {{ grid-template-columns:repeat(2,1fr); }} .span-4,.span-6,.span-8 {{ grid-column:span 12; }} .actions {{ grid-template-columns:1fr; }} }}
    @media print {{ :root {{ color-scheme:light; }} body {{ background:#fff; color:#111827; }} .card {{ background:#fff; box-shadow:none; border-color:#cbd5e1; break-inside:avoid; }} .subtitle,.meta,.chart-note,.kpi-detail,.kpi-label,.bar-label,.legend-item,footer,.action p {{ color:#475569; }} .donut::after {{ background:#fff; }} .bar-track,.stack {{ background:#e2e8f0; }} .shell {{ max-width:none; padding:10px; }} }}
  </style>
</head>
<body>
<main class="shell">
  <header>
    <div><h1>Payroll KPI Dashboard</h1><div class="subtitle">Aggregate paid-payroll view · {html.escape(period_label)} · Check date {html.escape(str(summary.get("check_date") or "not provided"))}</div></div>
    <div class="meta">Generated {generated}<br>Privacy-minimized: no employee identities</div>
  </header>

  <section class="kpis">
    <article class="card kpi"><div class="kpi-label">Employees</div><div class="kpi-value">{employees:,}</div><div class="kpi-detail">{employees_with_ot} recorded overtime</div></article>
    <article class="card kpi"><div class="kpi-label">Total hours</div><div class="kpi-value">{number(total_hours)}</div><div class="kpi-detail">{number(avg_hours)} average per employee</div></article>
    <article class="card kpi"><div class="kpi-label">Total earnings</div><div class="kpi-value">{money(total_earnings)}</div><div class="kpi-detail">{money(avg_earnings)} average per employee</div></article>
    <article class="card kpi"><div class="kpi-label">Overtime hours</div><div class="kpi-value accent">{number(hours.get("overtime",0))}</div><div class="kpi-detail">{float(summary["overtime_hours_pct_of_regular"]):.2f}% of regular hours</div></article>
    <article class="card kpi"><div class="kpi-label">Overtime pay</div><div class="kpi-value accent">{money(earnings.get("overtime",0))}</div><div class="kpi-detail">{float(summary["overtime_pay_pct_of_regular"]):.2f}% of regular pay</div></article>
    <article class="card kpi"><div class="kpi-label">OT participation</div><div class="kpi-value">{ot_employee_pct:.1f}%</div><div class="kpi-detail">{employees_with_ot} of {employees} employees</div></article>
  </section>

  <section class="grid">
    <article class="card chart-card span-4"><div class="chart-head"><h2>Overtime exposure</h2><span class="chart-note">Regular + OT hours</span></div>{donut(ot_hours_total_pct, COLORS["overtime"], f"{ot_hours_total_pct:.2f}%", "of worked hours")}</article>
    <article class="card chart-card span-4"><div class="chart-head"><h2>Overtime pay mix</h2><span class="chart-note">Regular + OT pay</span></div>{donut(ot_pay_total_pct, "#fb923c", f"{ot_pay_total_pct:.2f}%", "of base + OT pay")}</article>
    <article class="card chart-card span-4"><div class="chart-head"><h2>Employees with OT</h2><span class="chart-note">Workforce exposure</span></div>{donut(ot_employee_pct, "#8b5cf6", f"{ot_employee_pct:.1f}%", "of employees")}</article>

    <article class="card chart-card span-6">
      <div class="chart-head"><h2>Hours by pay category</h2><span class="chart-note">{number(total_hours)} total hours</span></div>
      <div class="stack">{stacked_bar(nonzero_hours,total_hours)}</div>
      <div class="legend">{''.join(f'<div class="legend-item"><span class="legend-name"><i class="dot" style="background:{COLORS[key]}"></i>{CATEGORY_LABELS[key]}</span><b>{number(value)}</b></div>' for key,value in nonzero_hours)}</div>
    </article>
    <article class="card chart-card span-6">
      <div class="chart-head"><h2>Earnings by pay category</h2><span class="chart-note">{money(total_earnings)} total earnings</span></div>
      <div class="stack">{stacked_bar(nonzero_earnings,total_earnings)}</div>
      <div class="legend">{''.join(f'<div class="legend-item"><span class="legend-name"><i class="dot" style="background:{COLORS[key]}"></i>{CATEGORY_LABELS[key]}</span><b>{money(value)}</b></div>' for key,value in nonzero_earnings)}</div>
    </article>

    <article class="card chart-card span-6"><div class="chart-head"><h2>Hours comparison</h2><span class="chart-note">Scaled to largest category</span></div>{bar_rows(nonzero_hours, number)}</article>
    <article class="card chart-card span-6"><div class="chart-head"><h2>Earnings comparison</h2><span class="chart-note">Scaled to largest category</span></div>{bar_rows(nonzero_earnings, money)}</article>

    <article class="card chart-card span-12">
      <div class="chart-head"><h2>Operational readout</h2><span class="chart-note">Current pay period</span></div>
      <div class="actions">
        <div class="action"><strong>OT is concentrated</strong><p>{employees_with_ot} employees account for {number(hours.get("overtime",0))} OT hours. Review these cases by schedule, fifth-day work, rescue coverage, and route overrun before the next payroll close.</p></div>
        <div class="action"><strong>Track pay and hours together</strong><p>OT represents {ot_hours_total_pct:.2f}% of regular-plus-OT hours but {ot_pay_total_pct:.2f}% of regular-plus-OT pay. Use both measures to avoid understating the cost effect.</p></div>
        <div class="action"><strong>Establish a trend baseline</strong><p>This is the first paid-payroll period in the dashboard. Add each new register to unlock period-over-period labor, OT, PTO, training, and bonus trend graphs.</p></div>
      </div>
    </article>
  </section>
  <footer><span>Source: {source_file} · Aggregate ADP Earnings Statement Register</span><span>Paid-payroll evidence; excludes taxes, deductions, banking data, and net pay.</span></footer>
</main>
</body>
</html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a privacy-safe payroll KPI dashboard from an aggregate summary.")
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary = json.loads(args.summary.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build_dashboard(summary), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
