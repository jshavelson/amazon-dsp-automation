import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, Download, FileSpreadsheet, RefreshCw, Scale, Truck } from 'lucide-react';
import { api } from '@/services/api';
import { useDataRefresh } from '@/hooks/useDataRefresh';

type MonthRow = { month: string; status: string; invoiceBasis: string; includedCost: number; amazonCoverage: number; difference: number; coverageRate: number | null; thirdPartyRentalCost: number; rentalLeaseCoverage: number; rentalLeaseBalance: number; lmrCost: number; lmrCoverage: number; lmrBalance: number; elementCost: number; acuraExcluded: number; rawExportTotal: number; fullAmazonCoverage: number };
type Vendor = { vendor: string; monthly: number[]; total: number; coverageClass: string };
type AmazonClass = { category: string; coverage: number[]; vehicleDays: number[]; perVehicleDay: (number | null)[]; group: 'lmr' | 'rental_lease' | 'branded' };
type Bridge = { period: string; finalGross: number | null; priorAdvanceDeducted: number | null; netReconciliation: number | null; invoiceIssued: string; note: string | null };
type Charge = { month: string; datePosted: string | null; vendor: string; account: string; netCharge: number; treatment: string; memo: string; vin: string | null; invoice: string | null };
type Payload = {
  period: string; asOf: string; source: string; tenant?: string; needsData?: boolean;
  dataSources?: { side: string; label: string; kind: string; reference: string | null; asOf: string | null; contentSha256?: string; uploadedBy?: string }[];
  currentPeriod?: { period: string; asOf: string; status: string; invoiceNumber: string | null; rentalLmrLeaseCoverage: number; fullFleetCoverage: number; source: string; costStatus: string } | null;
  summary: { threeMonthIncludedCost: number; threeMonthAmazonCoverage: number; threeMonthDifference: number; coverageRate: number; augustDifference: number; thirdPartyRentalCost: number; rentalLeaseCoverage: number; lmrCost: number; lmrCoverage: number; elementCost: number; acuraExcluded: number; fullAmazonCoverage: number; includedTransactions: number; excludedTransactions: number; unmatchedVinCharges: number };
  months: MonthRow[]; vendors: Vendor[]; amazonClasses: AmazonClass[]; invoiceBridge: Bridge[]; charges: Charge[]; notes: { topic: string; detail: string }[]; caveats: string[];
};

const usd = (v: number | null | undefined, digits = 0) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 0) => (v >= 0 ? '+' : '−') + usd(Math.abs(v), digits);
const tone = (v: number) => v >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';

const PairedBars: React.FC<{ title: string; subtitle: string; rows: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; masked: boolean }> = ({ title, subtitle, rows, aLabel, bLabel, masked }) => {
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1);
  return <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3><p className="text-xs text-gray-500 dark:text-slate-400">{subtitle}</p></div>
      <div className="flex gap-3 text-xs text-gray-500 dark:text-slate-400"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-red-500" />{aLabel}</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />{bLabel}</span></div></div>
    <div className="mt-4 space-y-4">{rows.map((r) => { const diff = r.b - r.a; return <div key={r.label}>
      <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-gray-700 dark:text-slate-200">{r.label}</span><span className={'font-semibold tabular-nums ' + tone(diff)}>{masked ? '•••' : signed(diff)}</span></div>
      <div className="space-y-1">
        <div className="flex items-center gap-2"><div className="h-3 flex-1 rounded bg-gray-100 dark:bg-slate-800"><div className="h-3 rounded bg-red-500" style={{ width: (r.a / max * 100) + '%' }} /></div><span className="w-24 text-right text-xs tabular-nums text-gray-600 dark:text-slate-300">{masked ? '•••' : usd(r.a)}</span></div>
        <div className="flex items-center gap-2"><div className="h-3 flex-1 rounded bg-gray-100 dark:bg-slate-800"><div className="h-3 rounded bg-emerald-500" style={{ width: (r.b / max * 100) + '%' }} /></div><span className="w-24 text-right text-xs tabular-nums text-gray-600 dark:text-slate-300">{masked ? '•••' : usd(r.b)}</span></div>
      </div></div>; })}</div>
  </article>;
};

const Kpi: React.FC<{ label: string; value: string; detail: string; valueClass?: string; icon: React.ReactNode }> = ({ label, value, detail, valueClass, icon }) => (
  <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className={'mt-2 text-2xl font-bold tabular-nums ' + (valueClass || 'text-gray-900 dark:text-white')}>{value}</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{detail}</p></div><span className="rounded-lg bg-gray-100 p-2 text-gray-600 dark:bg-slate-800 dark:text-slate-300">{icon}</span></div></article>
);

const FleetCostsPage: React.FC = () => {
  const [masked, setMasked] = useState(() => localStorage.getItem('jec-mask-financial') === '1');
  const [chargeMonth, setChargeMonth] = useState('all');
  const [chargeVendor, setChargeVendor] = useState('all');
  const { data, isLoading, error, refetch } = useQuery<Payload>({ queryKey: ['fleet-costs-reconciliation'], queryFn: () => api.get<Payload>('/fleet-costs'), staleTime: 5 * 60 * 1000 });
  const { refresh, isRefreshing } = useDataRefresh();
  const m = (v: number | null | undefined, d = 0) => masked ? '•••' : usd(v, d);
  const ms = (v: number, d = 0) => masked ? '•••' : signed(v, d);
  const toggleMask = () => setMasked((c) => { localStorage.setItem('jec-mask-financial', c ? '0' : '1'); return !c; });

  const charges = useMemo(() => (data?.charges || []).filter((c) => (chargeMonth === 'all' || c.month === chargeMonth) && (chargeVendor === 'all' || c.vendor === chargeVendor)), [data, chargeMonth, chargeVendor]);
  const chargeTotal = useMemo(() => charges.filter((c) => c.treatment === 'INCLUDE').reduce((s, c) => s + c.netCharge, 0), [charges]);

  const exportCsv = () => {
    if (!data) return;
    const head = ['Month', 'Status', 'Included fleet cost', 'Amazon coverage', 'Difference', 'Coverage %', 'Enterprise+Hertz cost', 'Rental/lease coverage', 'MerchAuto LMR cost', 'LMR coverage', 'Element', 'Acura excluded', 'Full Amazon fleet coverage'];
    const rows = data.months.map((r) => [r.month, r.status, r.includedCost, r.amazonCoverage, r.difference, r.coverageRate ?? '', r.thirdPartyRentalCost, r.rentalLeaseCoverage, r.lmrCost, r.lmrCoverage, r.elementCost, r.acuraExcluded, r.fullAmazonCoverage]);
    const csv = [head, ...rows].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'fleet-cost-reconciliation-jun-aug-2026.csv'; a.click(); URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">Loading fleet cost reconciliation…</div>;
  if (error || !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><strong>Fleet cost reconciliation could not be loaded.</strong><button onClick={() => refetch()} className="ml-3 underline">Retry</button></div>;

  // A workspace with no confirmed Digits upload has nothing to reconcile yet.
  if (data.needsData) return <div className="space-y-6 pb-10">
    <section><p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Fleet finance</p><h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Fleet Costs</h1></section>
    <section className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <FileSpreadsheet className="mx-auto text-gray-400" size={32} />
      <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">No fleet charges uploaded yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">Connect Digits or confirm an accounting upload for actual fleet expenses, then connect Amazon Cortex Payments for reimbursement coverage.</p>
      <a href="/connections" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Go to Connections</a>
    </section>
  </div>;

  const s = data.summary;
  const months = data.months;
  const vendorsList = ['all', ...new Set(data.charges.map((c) => c.vendor))];

  return <div className="space-y-6 pb-10">
    <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Fleet finance · {data.period}</p><h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Fleet Costs — what Amazon pays vs what I pay</h1><p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-slate-400">Actual fleet expenses from the connected accounting source (or confirmed upload) against vehicle coverage from Cortex Payments.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={toggleMask} aria-pressed={masked} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">{masked ? 'Show financial data' : 'Mask financial data'}</button>
        <button type="button" onClick={() => void refresh()} disabled={isRefreshing} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />{isRefreshing ? 'Refreshing…' : 'Refresh'}</button>
        <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download size={15} />Export months</button>
      </div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="3-month I paid (included)" value={m(s.threeMonthIncludedCost, 2)} detail={'Enterprise, Hertz, MerchAuto LMR, Element · Acura ' + m(s.acuraExcluded) + ' excluded'} icon={<Building2 size={20} />} />
      <Kpi label="3-month Amazon paid me (rental + LMR + lease classes)" value={m(s.threeMonthAmazonCoverage, 2)} detail="June/July final invoices + August advance" icon={<Truck size={20} />} />
      <Kpi label="3-month difference" value={ms(s.threeMonthDifference, 2)} valueClass={tone(s.threeMonthDifference)} detail={'Coverage rate ' + (masked ? '•••' : s.coverageRate.toFixed(1) + '%') + ' · posting-period, not net profit'} icon={s.threeMonthDifference >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />} />
      <Kpi label="August difference" value={ms(s.augustDifference, 2)} valueClass={tone(s.augustDifference)} detail="Provisional — August final reconciliation not yet posted" icon={<AlertTriangle size={20} />} />
    </section>

    {data.currentPeriod && <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide">Latest Amazon fleet payment · {data.currentPeriod.status}</p><h2 className="mt-1 text-lg font-bold">{data.currentPeriod.period} · {data.currentPeriod.invoiceNumber}</h2><p className="mt-1 text-sm">Rental + LMR + lease coverage: <strong>{m(data.currentPeriod.rentalLmrLeaseCoverage, 2)}</strong> · Full fleet coverage: <strong>{m(data.currentPeriod.fullFleetCoverage, 2)}</strong></p><p className="mt-1 text-xs">{data.currentPeriod.costStatus}; no unsupported difference is calculated.</p></div><div className="text-right text-xs"><p>Through {new Date(`${data.currentPeriod.asOf}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p><p className="mt-1 font-mono">{data.currentPeriod.source}</p></div></div>
    </section>}

    {data.dataSources && <section className="grid gap-3 sm:grid-cols-2">{data.dataSources.map((src) => (
      <article key={`${src.side}-${src.label}`} className={'rounded-xl border p-4 ' + (src.kind === 'tenant_upload' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900')}>
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{src.side}</p><p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{src.label}</p></div>
          <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' + (src.kind === 'tenant_upload' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300')}>{src.kind === 'tenant_upload' ? 'Your upload' : 'Reference'}</span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-gray-500 dark:text-slate-400">{src.reference}{src.contentSha256 ? ' · sha256 ' + src.contentSha256.slice(0, 12) : ''}</p>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">As of {src.asOf ? new Date(src.asOf).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'unknown'}{src.uploadedBy ? ' · uploaded by ' + src.uploadedBy : ''}</p>
      </article>))}</section>}

    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"><strong>Where the gap is:</strong> Enterprise/Hertz cost me {m(s.thirdPartyRentalCost)} over three months while Amazon's Rental Van + DSP Leased Van classes paid {m(s.rentalLeaseCoverage)} ({ms(s.rentalLeaseCoverage - s.thirdPartyRentalCost)}). MerchAuto LMR cost {m(s.lmrCost)} against {m(s.lmrCoverage)} LMR coverage ({ms(s.lmrCoverage - s.lmrCost)}). The LMR surplus has been covering the third-party rental shortfall; it stopped covering it in August.</section>

    <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Monthly reconciliation</h2><p className="text-xs text-gray-500 dark:text-slate-400">Included fleet expense vs Amazon rental/LMR/lease coverage</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Month</th><th className="px-4 py-3">Basis</th><th className="px-4 py-3 text-right">I paid</th><th className="px-4 py-3 text-right">Amazon paid</th><th className="px-4 py-3 text-right">Difference</th><th className="px-4 py-3 text-right">Coverage</th><th className="px-4 py-3 text-right">Ent/Hertz vs rental cov.</th><th className="px-4 py-3 text-right">LMR vs LMR cov.</th><th className="px-4 py-3 text-right">Full Amazon fleet pay</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{months.map((r) => <tr key={r.month} className="text-gray-700 dark:text-slate-200">
          <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{r.month}<span className={'ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' + (r.status === 'final' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200')}>{r.status}</span></td>
          <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{r.invoiceBasis}</td>
          <td className="px-4 py-3 text-right tabular-nums">{m(r.includedCost, 2)}</td><td className="px-4 py-3 text-right tabular-nums">{m(r.amazonCoverage, 2)}</td>
          <td className={'px-4 py-3 text-right font-semibold tabular-nums ' + tone(r.difference)}>{ms(r.difference, 2)}</td>
          <td className="px-4 py-3 text-right tabular-nums">{masked || r.coverageRate == null ? '•••' : r.coverageRate.toFixed(1) + '%'}</td>
          <td className={'px-4 py-3 text-right tabular-nums ' + tone(r.rentalLeaseBalance)}>{ms(r.rentalLeaseBalance)}<span className="block text-[11px] font-normal text-gray-500 dark:text-slate-400">{m(r.thirdPartyRentalCost)} vs {m(r.rentalLeaseCoverage)}</span></td>
          <td className={'px-4 py-3 text-right tabular-nums ' + tone(r.lmrBalance)}>{ms(r.lmrBalance)}<span className="block text-[11px] font-normal text-gray-500 dark:text-slate-400">{m(r.lmrCost)} vs {m(r.lmrCoverage)}</span></td>
          <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-slate-400">{m(r.fullAmazonCoverage, 2)}</td></tr>)}
          <tr className="bg-gray-50 font-semibold text-gray-900 dark:bg-slate-950 dark:text-white"><td className="px-5 py-3">3-month total</td><td /><td className="px-4 py-3 text-right tabular-nums">{m(s.threeMonthIncludedCost, 2)}</td><td className="px-4 py-3 text-right tabular-nums">{m(s.threeMonthAmazonCoverage, 2)}</td><td className={'px-4 py-3 text-right tabular-nums ' + tone(s.threeMonthDifference)}>{ms(s.threeMonthDifference, 2)}</td><td className="px-4 py-3 text-right tabular-nums">{masked ? '•••' : s.coverageRate.toFixed(1) + '%'}</td><td className={'px-4 py-3 text-right tabular-nums ' + tone(s.rentalLeaseCoverage - s.thirdPartyRentalCost)}>{ms(s.rentalLeaseCoverage - s.thirdPartyRentalCost)}</td><td className={'px-4 py-3 text-right tabular-nums ' + tone(s.lmrCoverage - s.lmrCost)}>{ms(s.lmrCoverage - s.lmrCost)}</td><td className="px-4 py-3 text-right tabular-nums">{m(s.fullAmazonCoverage, 2)}</td></tr>
        </tbody></table></div>
    </section>

    <section className="grid gap-4 xl:grid-cols-3">
      <PairedBars masked={masked} title="Included fleet expense vs Amazon coverage" subtitle="All included vendors vs rental + LMR + lease classes" aLabel="I paid" bLabel="Amazon paid" rows={months.map((r) => ({ label: r.month + ' · ' + r.status, a: r.includedCost, b: r.amazonCoverage }))} />
      <PairedBars masked={masked} title="LMR cost vs LMR coverage" subtitle="MerchAuto9150 vs Branded Last Mile Rental Van class" aLabel="MerchAuto LMR" bLabel="Amazon LMR" rows={months.map((r) => ({ label: r.month, a: r.lmrCost, b: r.lmrCoverage }))} />
      <PairedBars masked={masked} title="Third-party rental vs rental/lease coverage" subtitle="Enterprise + Hertz vs Rental Van + DSP Leased Van classes" aLabel="Rental cost" bLabel="Rental coverage" rows={months.map((r) => ({ label: r.month, a: r.thirdPartyRentalCost, b: r.rentalLeaseCoverage }))} />
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <article className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-gray-200 px-5 py-4 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Vendors I paid</h2><p className="text-xs text-gray-500 dark:text-slate-400">Accounting charges mapped to the Cortex Payments class that reimburses them</p></div>
        <table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Vendor</th><th className="px-3 py-3 text-right">Jun</th><th className="px-3 py-3 text-right">Jul</th><th className="px-3 py-3 text-right">Aug</th><th className="px-3 py-3 text-right">Total</th><th className="px-4 py-3">Reimbursed by</th></tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{data.vendors.map((v) => <tr key={v.vendor} className="text-gray-700 dark:text-slate-200"><td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{v.vendor}</td>{v.monthly.map((x, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{m(x)}</td>)}<td className="px-3 py-3 text-right font-semibold tabular-nums">{m(v.total)}</td><td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{v.coverageClass}</td></tr>)}</tbody></table></article>
      <article className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-gray-200 px-5 py-4 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Invoice bridge</h2><p className="text-xs text-gray-500 dark:text-slate-400">Amazon final gross less prior advance = net reconciliation payment</p></div>
        <table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Period</th><th className="px-3 py-3 text-right">Final gross</th><th className="px-3 py-3 text-right">Advance deducted</th><th className="px-3 py-3 text-right">Net paid</th><th className="px-4 py-3">Issued</th></tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{data.invoiceBridge.map((b) => <tr key={b.period} className="text-gray-700 dark:text-slate-200"><td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{b.period}</td><td className="px-3 py-3 text-right tabular-nums">{b.finalGross == null ? <span className="text-xs text-amber-700 dark:text-amber-300">{b.note}</span> : m(b.finalGross, 2)}</td><td className="px-3 py-3 text-right tabular-nums">{m(b.priorAdvanceDeducted, 2)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{b.netReconciliation == null ? '—' : m(b.netReconciliation, 2)}</td><td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{b.invoiceIssued}</td></tr>)}</tbody></table>
        <p className="px-5 py-3 text-xs text-gray-500 dark:text-slate-400">Full Amazon fleet coverage includes branded Amazon-owned classes that are excluded from the rental-only comparison above.</p></article>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">Amazon vehicle classes — what each class pays</h2><p className="text-xs text-gray-500 dark:text-slate-400">Coverage and vehicle-days by class; per vehicle-day shows the effective daily rate Amazon paid</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Class</th><th className="px-3 py-3">Group</th>{['Jun', 'Jul', 'Aug'].map((h) => <th key={h} className="px-3 py-3 text-right">{h} coverage</th>)}{['Jun', 'Jul', 'Aug'].map((h) => <th key={h + 'd'} className="px-3 py-3 text-right">{h} veh-days</th>)}<th className="px-3 py-3 text-right">$/veh-day (Aug)</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{data.amazonClasses.map((c) => <tr key={c.category} className={'text-gray-700 dark:text-slate-200 ' + (c.group === 'branded' ? 'opacity-70' : '')}><td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{c.category}</td><td className="px-3 py-3"><span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' + (c.group === 'lmr' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : c.group === 'rental_lease' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300')}>{c.group === 'lmr' ? 'LMR' : c.group === 'rental_lease' ? 'Rental / lease' : 'Branded (excluded)'}</span></td>{c.coverage.map((x, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{m(x)}</td>)}{c.vehicleDays.map((x, i) => <td key={'d' + i} className="px-3 py-3 text-right tabular-nums">{x}</td>)}<td className="px-3 py-3 text-right tabular-nums">{c.perVehicleDay[2] == null ? '—' : m(c.perVehicleDay[2], 2)}</td></tr>)}</tbody></table></div>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800"><div><h2 className="font-semibold text-gray-900 dark:text-white">Every charge I paid</h2><p className="text-xs text-gray-500 dark:text-slate-400">{charges.length} transactions · included total {m(chargeTotal, 2)} · {s.unmatchedVinCharges} charges still need VIN / service-period matching</p></div>
        <div className="flex gap-2"><select value={chargeMonth} onChange={(e) => setChargeMonth(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="all">All months</option>{months.map((r) => <option key={r.month} value={r.month}>{r.month}</option>)}</select><select value={chargeVendor} onChange={(e) => setChargeVendor(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">{vendorsList.map((v) => <option key={v} value={v}>{v === 'all' ? 'All vendors' : v}</option>)}</select></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Posted</th><th className="px-3 py-3">Vendor</th><th className="px-3 py-3">Account</th><th className="px-3 py-3 text-right">Charge</th><th className="px-3 py-3">Treatment</th><th className="px-3 py-3">VIN</th><th className="px-3 py-3">Memo</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{charges.map((c, i) => <tr key={i} className={'text-gray-700 dark:text-slate-200 ' + (c.treatment !== 'INCLUDE' ? 'opacity-60' : '')}><td className="px-5 py-2.5 tabular-nums">{c.datePosted}</td><td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white">{c.vendor}</td><td className="px-3 py-2.5 text-xs text-gray-500 dark:text-slate-400">{c.account}</td><td className="px-3 py-2.5 text-right tabular-nums">{m(c.netCharge, 2)}</td><td className="px-3 py-2.5"><span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold ' + (c.treatment === 'INCLUDE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200')}>{c.treatment}</span></td><td className="px-3 py-2.5 font-mono text-xs">{c.vin || <span className="text-amber-700 dark:text-amber-300">unmatched</span>}</td><td className="px-3 py-2.5 text-xs text-gray-500 dark:text-slate-400">{c.memo}</td></tr>)}</tbody></table></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><h3 className="flex items-center gap-2 font-semibold"><Scale size={16} />How to read this</h3><ul className="mt-2 list-disc space-y-1 pl-5">{data.caveats.map((c) => <li key={c}>{c}</li>)}</ul></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 text-sm dark:border-slate-800 dark:bg-slate-900"><h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><FileSpreadsheet size={16} />Source</h3><p className="mt-2 font-mono text-xs text-gray-600 dark:text-slate-300">{data.source}</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Reviewed {data.asOf} · {s.includedTransactions} included / {s.excludedTransactions} excluded Digits transactions. Update the workbook and press Refresh; this page reads it live.</p>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-slate-200">Reconciliation notes ({data.notes.length})</summary><dl className="mt-2 space-y-2 text-xs">{data.notes.map((n) => <div key={n.topic}><dt className="font-semibold text-gray-800 dark:text-slate-100">{n.topic}</dt><dd className="text-gray-600 dark:text-slate-300">{n.detail}</dd></div>)}</dl></details></article>
    </section>
  </div>;
};

export default FleetCostsPage;
