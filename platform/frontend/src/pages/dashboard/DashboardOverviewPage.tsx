import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, DollarSign, Eye, EyeOff, PackageCheck, ShieldCheck, Truck, Users } from 'lucide-react';

type Period = 'current' | 'six' | 'three-months';
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';
interface Metric { label: string; value: string; detail: string; tone: Tone }
interface TrendSeries { label: string; color: string; values: number[]; format?: (value: number) => string }

const weeks = ['W25', 'W26', 'W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37'];
const dcr = [99.71, 99.45, 99.32, 99.58, 99.46, 99.46, 99.39, 99.31, 99.43, 99.37, 99.44, 99.53, 99.7];
const pod = [99.58, 99.64, 99.66, 99.62, 99.64, 99.67, 99.56, 99.57, 99.62, 99.53, 99.62, 99.51, 99.52];
const packages = [66710, 78818, 68982, 70977, 67755, 68217, 69843, 70380, 69571, 73141, 70289, 70850, 68189];
const cdf = [59, 59, 52, 59, 47, 44, 51, 35, 42, 37, 43, 39, 30];
const safety = [11, 9, 9, 10, 15, 11, 14, 11, 15, 10, 8, 8, 3];
const activeDrivers = [80, 84, 82, 82, 81, 82, 79, 82, 83, 81, 81, 85, 81];
const adpActive = [100, 100, 102, 100, 103, 99, 101, 101, 103, 98, 103, 104, 106];

const toneClasses: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-100', green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100', red: 'bg-red-50 text-red-700 ring-red-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100', slate: 'bg-slate-50 text-slate-700 ring-slate-100',
};

const deliveryMetrics: Metric[] = [
  { label: 'Paid W37 incentive rating', value: 'Fantastic Plus', detail: 'Same-week reconciled payment evidence', tone: 'green' },
  { label: 'W37 packages delivered', value: '68,189', detail: 'Change from W36: −2,661', tone: 'blue' },
  { label: 'W37 DCR', value: '99.70%', detail: 'Change from W36: +0.17 pts', tone: 'green' },
  { label: 'W37 POD', value: '99.52%', detail: 'Change from W36: +0.01 pts', tone: 'green' },
  { label: 'W37 CDF negatives', value: '30', detail: 'Change from W36: −9', tone: 'amber' },
  { label: 'W37 DSB defects', value: '6', detail: 'No change from W36', tone: 'amber' },
  { label: 'W37 failed pickup stops', value: '0', detail: '0 of 3 pickup stops', tone: 'green' },
];
const workforceMetrics: Metric[] = [
  { label: 'W37 safety events', value: '3', detail: 'Change from W36: −5', tone: 'green' },
  { label: 'Fleet readiness', value: '82.0%', detail: '41 operational · 9 grounded', tone: 'amber' },
  { label: 'Actual driver count', value: '94', detail: '102 ADP active − 5 WC − 3 recent/future', tone: 'green' },
  { label: 'ADP active drivers', value: '102', detail: 'Primary driver job · Home Dept 000004', tone: 'blue' },
  { label: '30-day driver hires', value: '20', detail: '16 separations · net +4', tone: 'green' },
  { label: '30-day attrition', value: '16.00%', detail: 'Separations ÷ average driver HC', tone: 'amber' },
];
const financialMetrics: Metric[] = [
  { label: 'OT hours / regular', value: '1.30%', detail: '68.92 overtime hours', tone: 'blue' },
  { label: 'Paid W37 incentive earned', value: '$10,229.40', detail: 'Reconciled delivery + pickup invoice', tone: 'green' },
  { label: '3-month fleet coverage', value: '91.6%', detail: '$73,207 coverage / $79,905 cost', tone: 'amber' },
];

const MetricCard: React.FC<{ metric: Metric }> = ({ metric }) => <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{metric.label}</p><p className={`mt-3 inline-flex rounded-lg px-2.5 py-1 text-2xl font-bold ring-1 ${toneClasses[metric.tone]}`}>{metric.value}</p><p className="mt-3 text-sm leading-5 text-gray-500">{metric.detail}</p></article>;
const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => <div className="mb-4 mt-8 flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-semibold text-gray-900">{title}</h2><p className="text-sm text-gray-500">{subtitle}</p></div>;

const TrendChart: React.FC<{ title: string; labels: string[]; series: TrendSeries[] }> = ({ title, labels, series }) => {
  const [activePoint, setActivePoint] = useState<{ x: number; y: number; period: string; series: string; value: string; color: string } | null>(null);
  const values = series.flatMap((item) => item.values);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const isPercent = series.some((item) => item.format?.(100).includes('%'));
  const singleValuePadding = isPercent ? 0.25 : Math.max(Math.abs(rawMax) * 0.05, 1);
  const min = rawMin === rawMax ? rawMin - singleValuePadding : rawMin;
  const max = rawMin === rawMax ? rawMax + singleValuePadding : rawMax;
  const range = max - min;
  const midpoint = min + range / 2;
  const xFor = (index: number) => labels.length === 1 ? 50 : 8 + index / (labels.length - 1) * 84;
  const yFor = (value: number) => 82 - (value - min) / range * 64;
  const pointList = (items: number[]) => items.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ');
  const formatAxisValue = (value: number) => {
    if (series[0]?.format) return series[0].format(value);
    return value.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 });
  };

  return <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-semibold text-gray-900">{title}</h3><p className="mt-1 text-[11px] text-gray-400">Hover or focus a point for exact values</p></div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">{series.map((item) => <span key={item.label} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div>
    </div>
    <div className="relative mt-4 pl-14">
      {[{ value: max, top: '18%' }, { value: midpoint, top: '50%' }, { value: min, top: '82%' }].map((tick) => <span key={tick.top} className="pointer-events-none absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] font-medium tabular-nums text-gray-500" style={{ top: tick.top }}>{formatAxisValue(tick.value)}</span>)}
      <svg className="h-56 w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${title}. Use Tab to focus individual points for exact values.`}>
        {[18, 34, 50, 66, 82].map((y) => <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="0.4" />)}
        {series.map((item) => <polyline key={item.label} points={pointList(item.values)} fill="none" stroke={item.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
        {series.flatMap((item) => item.values.map((value, index) => {
          const x = xFor(index); const y = yFor(value); const formattedValue = item.format ? item.format(value) : value.toLocaleString();
          const point = { x, y, period: labels[index], series: item.label, value: formattedValue, color: item.color };
          return <circle key={`${item.label}-${index}`} cx={x} cy={y} r="1.8" fill={item.color} stroke="var(--chart-point-border)" strokeWidth="0.7" vectorEffect="non-scaling-stroke" tabIndex={0} className="cursor-crosshair outline-none focus:stroke-gray-900 dark:focus:stroke-white" aria-label={`${labels[index]}, ${item.label}: ${formattedValue}`} onMouseEnter={() => setActivePoint(point)} onMouseLeave={() => setActivePoint(null)} onFocus={() => setActivePoint(point)} onBlur={() => setActivePoint(null)}><title>{labels[index]} · {item.label}: {formattedValue}</title></circle>;
        }))}
      </svg>
      {activePoint && <div className="pointer-events-none absolute z-10 min-w-max rounded-lg bg-gray-950 px-3 py-2 text-xs text-white shadow-lg" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${activePoint.x / 100})`, top: `${activePoint.y}%`, transform: activePoint.x > 76 ? 'translate(-100%, -115%)' : activePoint.x < 24 ? 'translate(0, -115%)' : 'translate(-50%, -115%)' }}><p className="font-medium text-gray-300">{activePoint.period}</p><p className="mt-1 flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: activePoint.color }} /><span>{activePoint.series}</span><strong className="ml-1 tabular-nums">{activePoint.value}</strong></p></div>}
    </div>
    <div className="ml-14 grid text-center text-[10px] text-gray-400" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>{labels.map((label) => <span key={label}>{label}</span>)}</div>
  </article>;
};

const Progress: React.FC<{ label: string; value: number; max: number; color: string }> = ({ label, value, max, color }) => <div><div className="mb-1.5 flex justify-between text-sm"><span className="text-gray-600">{label}</span><strong>{value}</strong></div><div className="h-2 rounded-full bg-gray-100"><div className={`h-2 rounded-full ${color}`} style={{ width: `${value / max * 100}%` }} /></div></div>;
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{value}</p></div>;
const Action: React.FC<{ icon: React.ReactNode; title: string; detail: string; tone: Tone }> = ({ icon, title, detail, tone }) => <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100"><span className={`inline-flex rounded-lg p-2 ring-1 ${toneClasses[tone]}`}>{icon}</span><h3 className="mt-4 font-semibold text-gray-900">{title}</h3><p className="mt-2 text-sm leading-5 text-gray-500">{detail}</p></article>;

const DashboardOverviewPage: React.FC = () => {
  const [period, setPeriod] = useState<Period>(() => (localStorage.getItem('jec-kpi-period-view') as Period) || 'three-months');
  const [financialMasked, setFinancialMasked] = useState(() => localStorage.getItem('jec-mask-financial') === '1');
  useEffect(() => localStorage.setItem('jec-kpi-period-view', period), [period]);
  useEffect(() => localStorage.setItem('jec-mask-financial', financialMasked ? '1' : '0'), [financialMasked]);
  const start = period === 'six' ? -6 : period === 'three-months' ? -13 : -1;
  const labels = useMemo(() => weeks.slice(start), [start]); const viewLabel = period === 'current' ? 'W37 current view' : period === 'six' ? 'W32–W37 trailing six weeks' : 'W25–W37 trailing three months';
  return <div className="space-y-6 pb-10"><section className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-600">DFH7 · Executive operating view</p><h1 className="mt-1 text-2xl font-bold text-gray-900">JECS Amazon DSP KPI Dashboard</h1><p className="mt-1 text-sm text-gray-500">Scorecard through W37 · rebuilt September 19, 2026 at 3:25 PM EDT</p></div><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setFinancialMasked((value) => !value)} aria-pressed={financialMasked} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">{financialMasked ? <Eye size={16} /> : <EyeOff size={16} />}{financialMasked ? 'Show financial data' : 'Mask financial data'}</button><div className="flex rounded-lg bg-gray-100 p-1 dark:bg-slate-800">{([['current', 'Current'], ['six', '6 weeks'], ['three-months', '3 months']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded-md px-3 py-2 text-sm font-medium ${period === value ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'}`}>{label}</button>)}</div></div></section>
    <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p><strong>Source freshness:</strong> Scorecard W37 is current. Fleet operations are 2 days old. ADP was captured September 16 and is 3 days old. Payment, payroll, route forecast, and fleet costs retain separately labeled periods.</p></section>
    <SectionHeading title="Delivery performance & quality" subtitle="Latest completed Amazon scorecard" /><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{deliveryMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section>
    <SectionHeading title="Safety, fleet & workforce" subtitle="Execution capacity and people coverage" /><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{workforceMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section>
    <SectionHeading title="Financial & cost control" subtitle="Separately labeled payroll, incentive, and fleet periods" />{financialMasked ? <section className="grid min-h-36 place-items-center rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><div><EyeOff className="mx-auto mb-2" />Financial data masked</div></section> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{financialMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</section>}
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><strong>{viewLabel}:</strong> Scorecard and paid invoice metrics use W37. ADP timecards cover September 13–19. Finalized payroll covers August 23–September 5.</section>
    <SectionHeading title="Delivery, quality, safety & workforce trends" subtitle={viewLabel} /><section className="grid gap-4 xl:grid-cols-2"><TrendChart title="DCR and POD" labels={labels} series={[{ label: 'DCR', color: '#16a34a', values: dcr.slice(start), format: (v) => `${v.toFixed(2)}%` }, { label: 'POD', color: '#0ea5e9', values: pod.slice(start), format: (v) => `${v.toFixed(2)}%` }]} /><TrendChart title="Delivered packages" labels={labels} series={[{ label: 'Packages', color: '#8b5cf6', values: packages.slice(start), format: (v) => v.toLocaleString() }]} /><TrendChart title="Customer feedback and safety exceptions" labels={labels} series={[{ label: 'CDF negatives', color: '#f59e0b', values: cdf.slice(start) }, { label: 'Safety events', color: '#ef4444', values: safety.slice(start) }]} /><TrendChart title="Scorecard active DAs vs ADP" labels={labels} series={[{ label: 'Scorecard active DAs', color: '#0ea5e9', values: activeDrivers.slice(start) }, { label: 'ADP active employees', color: '#f59e0b', values: adpActive.slice(start) }]} /></section>
    <SectionHeading title="Fleet and Peak capacity" subtitle="Readiness, ownership, and published route demand" /><section className="grid gap-4 lg:grid-cols-3"><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100"><Truck className="text-blue-600" size={22} /><h3 className="mt-3 font-semibold">Fleet status · Sep 17</h3><div className="mt-5 space-y-4"><Progress label="Operational" value={41} max={50} color="bg-emerald-500" /><Progress label="Grounded" value={9} max={50} color="bg-red-500" /></div></article><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100"><ShieldCheck className="text-violet-600" size={22} /><h3 className="mt-3 font-semibold">Fleet ownership mix</h3><div className="mt-5 space-y-4"><Progress label="Amazon owned" value={25} max={50} color="bg-blue-500" /><Progress label="Amazon LMR" value={14} max={50} color="bg-violet-500" /><Progress label="Third-party rental" value={11} max={50} color="bg-amber-500" /></div></article><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100"><CalendarDays className="text-amber-600" size={22} /><h3 className="mt-3 font-semibold">Published route forecast</h3><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Stat label="W37" value="37" /><Stat label="W45" value="50" /><Stat label="W49" value="62" /></div><p className="mt-5 text-sm text-gray-500">Peak demand rises 68% from W37 to W49. Maintain hiring and fleet-readiness coverage ahead of W45.</p></article></section>
    <SectionHeading title="Route capacity and staffing coverage" subtitle="Published W37–W49 demand versus 94 actual available drivers" /><section className="grid gap-4 xl:grid-cols-2"><TrendChart title="Published route forecast" labels={['W37','W38','W39','W40','W41','W42','W43','W44','W45','W46','W47','W48','W49']} series={[{ label: 'Max routes', color: '#8b5cf6', values: [37,35,37,39,44,44,42,44,50,50,53,60,62] }]} /><TrendChart title="Actual drivers per max route" labels={['W37','W38','W39','W40','W41','W42','W43','W44','W45','W46','W47','W48','W49']} series={[{ label: 'Drivers per route', color: '#0ea5e9', values: [2.54,2.69,2.54,2.41,2.14,2.14,2.24,2.14,1.88,1.88,1.77,1.57,1.52], format: (v) => `${v.toFixed(2)}:1` }]} /></section>

    <SectionHeading title="Hiring and attrition" subtitle="Workforce flow and route coverage" /><section className="grid gap-4 xl:grid-cols-2"><TrendChart title="Driver hiring versus separations" labels={['Jun','Jul','Aug']} series={[{ label: 'Hires', color: '#16a34a', values: [25,15,17] }, { label: 'Separations', color: '#ef4444', values: [12,16,14] }]} /><TrendChart title="Monthly driver attrition rate" labels={['Jun','Jul','Aug']} series={[{ label: 'Attrition', color: '#f59e0b', values: [13.48,16.93,14.66], format: (v) => `${v.toFixed(2)}%` }]} /></section>

    <SectionHeading title="Workforce, payroll, and route economics" subtitle="Finalized payroll, W37 invoice, and latest operating evidence" /><section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
      ['Paid payroll employees','110','9 with OT'],['Regular + OT hours','5,367.19','5,298.27 regular'],['Regular + OT pay','$112,867.47','OT pay 1.97% of regular'],['Route blocks','226','220×10h · 1×9h · 1×8h · 4×7h'],['Eligible packages','68,195','5 pickup packages'],['Training days','4','Reconciled WST to invoice'],['Driver sentiment','89.7%','48.1% response rate'],['Average DVIC duration','60.7 sec','61 inspections · 0 at or under 30 sec'],
    ].map(([label,value,detail]) => <article key={label} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{financialMasked && (label.includes('pay') || label.includes('OT')) ? '••••••' : value}</p><p className="mt-2 text-sm text-gray-500 dark:text-slate-400">{financialMasked && (detail.includes('pay') || detail.includes('OT')) ? 'Financial data masked' : detail}</p></article>)}</section>

    <SectionHeading title="Reimbursement review modules" subtitle="Independent evidence-gated billable modules" /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[
      ['Weekly Payments · 2026-W37','Closed','0 dispute candidates · 1 route / $327 recovered'],['Capacity & Reliability · 2026-W36','Closed','245 routes verified · 0 candidates'],['Fixed Monthly · August 2026','Submitted','Approval-gated case · Amazon confirmation retained'],['FIF reimbursements','Import ready','Requires approved claims + reimbursement invoice'],['Fifth-Day Overtime','Import ready','Requires DA route detail + payroll reimbursement'],['Next Mile Tuition','Import ready','Requires InStride + payroll reimbursement'],['Meals, Awards & Adjustments','Import ready','Requires program support + invoice adjustments'],
    ].map(([title,status,detail]) => <article key={title} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{status}</span></div><p className="mt-3 text-sm leading-5 text-gray-500 dark:text-slate-400">{financialMasked && detail.includes('$') ? 'Financial data masked' : detail}</p></article>)}</section>

    <SectionHeading title="Operational focus" subtitle="Immediate management actions" /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Action icon={<PackageCheck size={20} />} title="Protect quality gains" detail="DCR improved to 99.70%; keep RTS and business-closed controls tight." tone="green" /><Action icon={<Truck size={20} />} title="Recover fleet readiness" detail="Nine grounded vehicles keep readiness at 82%; prioritize return-to-service dates." tone="amber" /><Action icon={<Users size={20} />} title="Retain the hiring gain" detail="Net +4 over 30 days, but 16% attrition still requires weekly retention reviews." tone="blue" /><Action icon={<DollarSign size={20} />} title="Close fleet cost gap" detail={financialMasked ? 'Financial data masked.' : 'Three-month coverage is 91.6%; target the $6,698 uncovered balance.'} tone="violet" /></section>

    <SectionHeading title="Source data" subtitle="Periods, status, and operational use" /><section className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950/60 dark:text-slate-400"><tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Reporting period</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Dashboard use</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-slate-800">{[
      ['Weekly operations summaries','W25–W37','Latest 13-week window','Packages, DCR, POD, CDF, DSB, safety, active DAs'],['WST / invoice reconciliation','W37 2026','Same-week reconciled','Incentive, route blocks, packages, pickups, training'],['ADP timecard snapshot','Sep 13–19, 2026','Newest captured snapshot','Current hours and employees with time'],['ADP worker roster','As of Sep 16','Newest captured snapshot','Active-driver trend, hiring, separation, attrition'],['Finalized payroll summary','Aug 23–Sep 5','Newest finalized register','Regular and overtime hours/pay and ratios'],['Fleet operating snapshot','Sep 17 operations','Dispatch readiness + 50 VIN roster','Fleet count, readiness, and ownership mix'],['Published route forecast','Sep 3 publication','Amazon communication','Peak weekly route targets through W49'],['Fleet expense reconciliation','Jun–Aug 2026','June/July final; August advance','Fleet cost, coverage, and monthly differences'],
    ].map(([source,reporting,status,use]) => <tr key={source}><td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{source}</td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{reporting}</td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{status}</td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{use}</td></tr>)}</tbody></table></div></section>
  </div>;
};

export default DashboardOverviewPage;
