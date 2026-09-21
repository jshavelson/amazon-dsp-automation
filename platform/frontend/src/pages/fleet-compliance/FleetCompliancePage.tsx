import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Database,
  Download,
  FileWarning,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Truck,
  Wrench,
} from 'lucide-react';
import { api } from '@/services/api';

type Severity = 'critical' | 'warning' | 'info';
type ComplianceStatus = 'grounded' | 'action_required' | 'monitor' | 'evidence_gap' | 'ready';

interface ComplianceIssue {
  category: string;
  severity: Severity;
  label: string;
}

interface PmIssue {
  status: 'DUE' | 'DUE_SOON' | string;
  issueType: string;
  serviceStatus: string;
  issueId: string;
}

interface ComplianceVehicle {
  vin: string;
  unit: string;
  year: number;
  make: string;
  model: string;
  registrationNumber?: string;
  registrationState?: string;
  registrationExpiryDate?: string;
  registrationDaysRemaining?: number;
  ownership: string;
  provider?: string;
  ownershipEndDate?: string;
  ownershipDaysRemaining?: number;
  operationalStatus: 'OPERATIONAL' | 'GROUNDED';
  portalOperationalStatus?: string;
  complianceStatus: ComplianceStatus;
  priority: number;
  inspectionCount: number;
  inspectionTypes: string[];
  pmIssues: PmIssue[];
  healthStatuses: Record<string, string>;
  issues: ComplianceIssue[];
  nextAction: string;
  serviceTier?: string;
  lastRouteCompletedInDays?: number;
}

interface WearTearAction {
  id: string;
  title: string;
  detail: string;
}

interface WearTearCandidate {
  vin: string;
  unit: string;
  grade: number;
  lastPave: string;
  reportSection: string;
  operationalStatus: 'OPERATIONAL' | 'GROUNDED' | 'UNKNOWN';
  ownership: string;
  provider?: string;
  caseNumbers: string[];
  recommendedAction: string;
}

interface WearTearLscCase {
  caseNumber: string;
  openedAt: string;
  lastUpdateAt: string;
  type: string;
  subtype: string;
  category: string;
  vin?: string | null;
  unit?: string | null;
  operationalStatus?: string | null;
  status: string;
  summary: string;
  nextAction: string;
  source: string;
}

interface WearAndTearCompliance {
  metric: string;
  currentPercent: number;
  targetPercent: number;
  stretchPercent: number;
  planningDenominator: number;
  estimatedCurrentCompliant: number;
  targetCompliant: number;
  minimumAdditionalCompliant: number;
  stretchCompliant: number;
  stretchAdditionalCompliant: number;
  percentagePointGap: number;
  dueDate: string;
  planningBasis: string;
  repairCandidates: WearTearCandidate[];
  lscCases: WearTearLscCase[];
  openLscCaseCount: number;
  actions: WearTearAction[];
  source: { subject: string; from: string; archive: string };
}

interface CompliancePayload {
  asOf: string;
  generatedAt: string;
  summary: {
    registeredFleet: number;
    operational: number;
    grounded: number;
    readinessRate: number;
    pmDue: number;
    pmDueSoon: number;
    pmSourceIssues: number;
    pmUnmatchedVehicles: number;
    inspectionVehicles: number;
    inspectionCoverageRate: number;
    openMaintenanceIssues: number;
    statusCounts: Record<string, number>;
    ownershipCounts: Record<string, number>;
  };
  vehicles: ComplianceVehicle[];
  unmatchedPmIssues: Array<{ vin: string; issues: PmIssue[] }>;
  wearAndTear?: WearAndTearCompliance | null;
  sources: Array<{ label: string; asOf: string; path: string }>;
  reconciliation: { currentRosterVinCount?: number; portalVinCount?: number; vinSetsMatch?: boolean; note?: string };
}

const statusMeta: Record<ComplianceStatus, { label: string; classes: string }> = {
  grounded: { label: 'Grounded', classes: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200' },
  action_required: { label: 'Action required', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200' },
  monitor: { label: 'Monitor', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200' },
  evidence_gap: { label: 'Evidence gap', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200' },
  ready: { label: 'Ready', classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' },
};

const pretty = (value?: string) => (value || 'Unknown').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());

const FleetCompliancePage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ComplianceStatus>('all');
  const [ownership, setOwnership] = useState('all');
  const [expandedVin, setExpandedVin] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('fleet-compliance-reviewed') || '[]'); } catch { return []; }
  });
  const [completedWearActions, setCompletedWearActions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('fleet-wear-actions-reviewed') || '[]'); } catch { return []; }
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery<CompliancePayload>({
    queryKey: ['fleet-compliance'],
    queryFn: () => api.get<CompliancePayload>('/fleet-compliance'),
    staleTime: 5 * 60 * 1000,
  });

  const ownershipOptions = useMemo(
    () => [...new Set((data?.vehicles || []).map((vehicle) => vehicle.ownership))].sort(),
    [data?.vehicles]
  );

  const filteredVehicles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.vehicles || []).filter((vehicle) => {
      const matchesQuery = !needle || [vehicle.unit, vehicle.vin, vehicle.make, vehicle.model, vehicle.provider, vehicle.registrationNumber]
        .some((value) => String(value || '').toLowerCase().includes(needle));
      return matchesQuery
        && (status === 'all' || vehicle.complianceStatus === status)
        && (ownership === 'all' || vehicle.ownership === ownership);
    });
  }, [data?.vehicles, ownership, query, status]);

  const toggleReviewed = (vin: string) => {
    setReviewed((current) => {
      const next = current.includes(vin) ? current.filter((item) => item !== vin) : [...current, vin];
      localStorage.setItem('fleet-compliance-reviewed', JSON.stringify(next));
      return next;
    });
  };

  const toggleWearAction = (actionId: string) => {
    setCompletedWearActions((current) => {
      const next = current.includes(actionId) ? current.filter((item) => item !== actionId) : [...current, actionId];
      localStorage.setItem('fleet-wear-actions-reviewed', JSON.stringify(next));
      return next;
    });
  };

  const exportCsv = () => {
    const header = ['Unit', 'VIN', 'Vehicle', 'Readiness', 'Compliance', 'Ownership', 'Provider', 'Ownership end', 'DVIC records', 'PM status', 'Next action'];
    const rows = filteredVehicles.map((vehicle) => [
      vehicle.unit, vehicle.vin, `${vehicle.year} ${vehicle.make} ${vehicle.model}`, vehicle.operationalStatus,
      statusMeta[vehicle.complianceStatus].label, vehicle.ownership, vehicle.provider || '', vehicle.ownershipEndDate || '',
      vehicle.inspectionCount, vehicle.pmIssues.map((item) => item.status).join(' | '), vehicle.nextAction,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fleet-compliance-${data?.asOf || 'current'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">Loading fleet compliance evidence…</div>;
  if (error || !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><strong>Fleet compliance data could not be loaded.</strong><button onClick={() => refetch()} className="ml-3 underline">Retry</button></div>;

  const cards = [
    { label: 'Fleet readiness', value: `${data.summary.operational}/${data.summary.registeredFleet}`, detail: `${data.summary.readinessRate}% operational`, icon: Truck, tone: 'blue' },
    { label: 'Grounded units', value: data.summary.grounded, detail: 'Dispatch-reported hold', icon: AlertTriangle, tone: 'red' },
    { label: 'PM attention', value: data.summary.pmSourceIssues, detail: `${data.summary.pmDue + data.summary.pmDueSoon} roster-matched · ${data.summary.pmUnmatchedVehicles} reconcile`, icon: Wrench, tone: 'amber' },
    { label: 'DVIC evidence', value: `${data.summary.inspectionVehicles}/${data.summary.registeredFleet}`, detail: `${data.summary.inspectionCoverageRate}% in source pull`, icon: ClipboardCheck, tone: 'emerald' },
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Fleet operations · evidence-backed</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Fleet Compliance</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-slate-400">Manage readiness, PM, inspection evidence, registrations, and rental or lease deadlines from one reconciled vehicle roster.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">Readiness as of {data.asOf}</span>
          <button onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />Refresh</button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download size={15} />Export queue</button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon, tone }) => (
          <article key={label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between"><div><p className="text-sm font-medium text-gray-500 dark:text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{detail}</p></div><span className={`rounded-lg p-2 ${tone === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : tone === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : tone === 'emerald' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}><Icon size={20} /></span></div>
          </article>
        ))}
      </section>

      {data.wearAndTear && <section className="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm dark:border-orange-900/70 dark:bg-slate-900">
        <div className="border-b border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-white p-5 dark:border-orange-900/60 dark:from-orange-950/45 dark:via-amber-950/25 dark:to-slate-900">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-orange-100 p-2.5 text-orange-700 dark:bg-orange-950 dark:text-orange-300"><Target size={22} /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">Current quarter rolling compliance</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Wear &amp; Tear Recovery Plan</h2>
                <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-slate-300">Amazon reports {data.wearAndTear.estimatedCurrentCompliant} of {data.wearAndTear.planningDenominator} eligible vehicles at Fair or better. Open LSC cases remain action items and do not count as compliant until Amazon accepts the replacement FCA.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[430px]">
              <div className="rounded-lg border border-red-200 bg-white px-3 py-2 dark:border-red-900 dark:bg-slate-950"><p className="text-2xl font-bold text-red-700 dark:text-red-300">{data.wearAndTear.currentPercent.toFixed(1)}%</p><p className="text-[11px] text-gray-500 dark:text-slate-400">Current · {data.wearAndTear.estimatedCurrentCompliant}/{data.wearAndTear.planningDenominator}</p></div>
              <div className="rounded-lg border border-orange-200 bg-white px-3 py-2 dark:border-orange-900 dark:bg-slate-950"><p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{data.wearAndTear.targetCompliant}/{data.wearAndTear.planningDenominator}</p><p className="text-[11px] text-gray-500 dark:text-slate-400">Target · {Math.round(data.wearAndTear.targetCompliant / data.wearAndTear.planningDenominator * 100)}%</p></div>
              <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-900 dark:bg-slate-950"><p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">+{data.wearAndTear.minimumAdditionalCompliant}</p><p className="text-[11px] text-gray-500 dark:text-slate-400">Minimum passes needed</p></div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-gray-700 dark:text-slate-200">{data.wearAndTear.currentPercent.toFixed(1)}% compliant</span><span className="font-semibold text-orange-700 dark:text-orange-300">Target ≥ {data.wearAndTear.targetPercent.toFixed(0)}%</span></div>
            <div className="relative h-3 overflow-visible rounded-full bg-gray-200 dark:bg-slate-700">
              <div className="h-3 rounded-full bg-gradient-to-r from-red-500 to-orange-500" style={{ width: `${Math.min(data.wearAndTear.currentPercent, 100)}%` }} />
              <span className="absolute -top-1 h-5 w-0.5 bg-gray-900 dark:bg-white" style={{ left: `${data.wearAndTear.targetPercent}%` }} aria-label={`${data.wearAndTear.targetPercent}% target`} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-slate-400"><span>{data.wearAndTear.percentagePointGap.toFixed(1)} percentage-point gap · due {data.wearAndTear.dueDate}</span><span>Schedule {data.wearAndTear.stretchAdditionalCompliant} completions for {data.wearAndTear.stretchCompliant}/{data.wearAndTear.planningDenominator} ({Math.round(data.wearAndTear.stretchCompliant / data.wearAndTear.planningDenominator * 100)}%) buffer</span></div>
          </div>
        </div>

        <div className="grid gap-5 p-5 xl:grid-cols-[1fr_1.25fr]">
          <div>
            <div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900 dark:text-white">Action checklist</h3><span className="text-xs text-gray-500 dark:text-slate-400">{completedWearActions.length}/{data.wearAndTear.actions.length} reviewed</span></div>
            <div className="mt-3 space-y-2">
              {data.wearAndTear.actions.map((action) => {
                const done = completedWearActions.includes(action.id);
                return <label key={action.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-950'}`}>
                  <input type="checkbox" checked={done} onChange={() => toggleWearAction(action.id)} className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600" />
                  <span><strong className={`block text-sm ${done ? 'text-emerald-800 dark:text-emerald-200' : 'text-gray-900 dark:text-white'}`}>{action.title}</strong><span className="mt-1 block text-xs leading-relaxed text-gray-600 dark:text-slate-300">{action.detail}</span></span>
                </label>;
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><FileWarning size={17} className="text-orange-600" />Wear &amp; Tear LSC cases</h3><span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">{data.wearAndTear.openLscCaseCount} open</span></div>
            <div className="mt-3 space-y-3">
              {data.wearAndTear.lscCases.map((item) => <article key={item.caseNumber} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase text-orange-700 dark:text-orange-300">LSC #{item.caseNumber}</p><h4 className="text-sm font-semibold text-gray-900 dark:text-white">{item.type} · {item.subtype}</h4></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.status === 'action_required' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{pretty(item.status)}</span></div>
                <dl className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2 dark:text-slate-300"><div><dt className="inline font-semibold">Vehicle: </dt><dd className="inline">{item.unit || 'VIN not stated'}{item.vin ? ` · ${item.vin}` : ''}</dd></div><div><dt className="inline font-semibold">Last update: </dt><dd className="inline">{item.lastUpdateAt.slice(0, 10)}</dd></div></dl>
                <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">{item.summary}</p>
                <p className="mt-2 rounded-md bg-orange-50 p-2 text-xs text-orange-900 dark:bg-orange-950/40 dark:text-orange-200"><strong>Next action:</strong> {item.nextAction}</p>
              </article>)}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-slate-800">
          <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold text-gray-900 dark:text-white">Grade-2 repair candidates</h3><p className="text-xs text-gray-500 dark:text-slate-400">Exact Poor-grade VINs from the report · operational vehicles first · close 3, schedule 4</p></div><span className="text-xs text-gray-500 dark:text-slate-400">{data.wearAndTear.repairCandidates.length} candidates</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Priority vehicle</th><th className="px-4 py-3">Readiness</th><th className="px-4 py-3">Current grade</th><th className="px-4 py-3">Last PAVE</th><th className="px-4 py-3">LSC</th><th className="px-4 py-3">Required action</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{data.wearAndTear.repairCandidates.map((candidate, index) => <tr key={candidate.vin} className="align-top"><td className="px-5 py-3"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600 dark:bg-slate-800 dark:text-slate-300">{index + 1}</span><strong className="text-gray-900 dark:text-white">{candidate.unit}</strong><span className="ml-2 font-mono text-[11px] text-gray-400">{candidate.vin}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${candidate.operationalStatus === 'OPERATIONAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>{pretty(candidate.operationalStatus)}</span></td><td className="px-4 py-3 font-semibold text-red-700 dark:text-red-300">{candidate.grade} · Poor</td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{candidate.lastPave}</td><td className="px-4 py-3">{candidate.caseNumbers.length ? candidate.caseNumbers.map((caseNumber) => <span key={caseNumber} className="rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">#{caseNumber}</span>) : <span className="text-xs text-gray-400">None linked</span>}</td><td className="max-w-sm px-4 py-3 text-xs text-gray-600 dark:text-slate-300">{candidate.recommendedAction}</td></tr>)}</tbody>
            </table>
          </div>
        </div>

        <div className="border-t border-orange-100 bg-orange-50/60 px-5 py-3 text-xs text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-200"><strong>Planning basis:</strong> {data.wearAndTear.planningBasis}</div>
      </section>}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <article className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/70 dark:bg-red-950/30">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-200"><AlertTriangle size={19} /><h2 className="font-semibold">Priority action queue</h2></div>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{(data.summary.statusCounts.grounded || 0) + (data.summary.statusCounts.action_required || 0)} units require release, maintenance, or document action before normal assignment. Grounded status comes from dispatch readiness; PM and document dates come from Fleet Portal evidence.</p>
        </article>
        <article className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-gray-900 dark:text-white"><ShieldCheck size={19} className="text-emerald-600" /><h2 className="font-semibold">Roster reconciliation</h2></div>
          <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{data.reconciliation.vinSetsMatch ? 'Matched' : 'Review required'} · {data.reconciliation.currentRosterVinCount} dispatch VINs / {data.reconciliation.portalVinCount} portal VINs</p>
        </article>
      </section>

      {data.unmatchedPmIssues.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/70 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200"><Wrench size={18} /><h2 className="font-semibold">PM roster reconciliation required</h2></div>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{data.unmatchedPmIssues.length} PM records reference VINs that are not in the current 50-vehicle roster. Confirm whether these are returned assets, replacement vehicles, or stale maintenance records.</p>
        <div className="mt-3 flex flex-wrap gap-2">{data.unmatchedPmIssues.map((item) => <span key={item.vin} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200">{item.vin} · {item.issues.map((issue) => pretty(issue.status)).join(', ')}</span>)}</div>
      </section>}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-gray-200 p-4 xl:flex-row xl:items-center xl:justify-between dark:border-slate-800">
          <div><h2 className="font-semibold text-gray-900 dark:text-white">Vehicle compliance queue</h2><p className="text-xs text-gray-500 dark:text-slate-400">{filteredVehicles.length} of {data.vehicles.length} vehicles · highest-risk first</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, VIN, plate, provider…" className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none sm:w-72 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="all">All statuses</option>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
            <select value={ownership} onChange={(event) => setOwnership(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="all">All ownership</option>{ownershipOptions.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-4 py-3">Unit / vehicle</th><th className="px-4 py-3">Readiness</th><th className="px-4 py-3">Ownership</th><th className="px-4 py-3">Inspection</th><th className="px-4 py-3">PM</th><th className="px-4 py-3">Priority / next action</th><th className="px-4 py-3">Review</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {filteredVehicles.map((vehicle) => {
                const open = expandedVin === vehicle.vin;
                const wasReviewed = reviewed.includes(vehicle.vin);
                const meta = statusMeta[vehicle.complianceStatus];
                return <React.Fragment key={vehicle.vin}>
                  <tr className="align-top hover:bg-gray-50/70 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-4"><button onClick={() => setExpandedVin(open ? null : vehicle.vin)} className="flex items-start gap-2 text-left"><span className="mt-0.5 text-gray-400">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span><span><strong className="block text-gray-900 dark:text-white">{vehicle.unit}</strong><span className="block text-xs text-gray-500 dark:text-slate-400">{vehicle.year} {vehicle.make} {vehicle.model}</span><span className="block font-mono text-[11px] text-gray-400">{vehicle.vin}</span></span></button></td>
                    <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${vehicle.operationalStatus === 'GROUNDED' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>{pretty(vehicle.operationalStatus)}</span></td>
                    <td className="px-4 py-4"><strong className="block text-gray-800 dark:text-slate-100">{pretty(vehicle.ownership)}</strong><span className="block text-xs text-gray-500 dark:text-slate-400">{vehicle.provider || 'Provider unavailable'}</span>{vehicle.ownershipEndDate && <span className={`block text-xs ${(vehicle.ownershipDaysRemaining ?? 999) <= 30 ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`}>Ends {vehicle.ownershipEndDate}</span>}</td>
                    <td className="px-4 py-4"><strong className={vehicle.inspectionCount ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300'}>{vehicle.inspectionCount ? `${vehicle.inspectionCount} record${vehicle.inspectionCount === 1 ? '' : 's'}` : 'Evidence gap'}</strong><span className="block text-xs text-gray-500 dark:text-slate-400">Sep 7 evidence pull</span></td>
                    <td className="px-4 py-4">{vehicle.pmIssues.length ? vehicle.pmIssues.map((issue) => <span key={issue.issueId} className={`mr-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${issue.status === 'DUE' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{pretty(issue.status)}</span>) : <span className="text-emerald-700 dark:text-emerald-300">No open PM flag</span>}</td>
                    <td className="max-w-sm px-4 py-4"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${meta.classes}`}>{meta.label}</span><p className="mt-2 text-xs text-gray-600 dark:text-slate-300">{vehicle.nextAction}</p></td>
                    <td className="px-4 py-4"><button onClick={() => toggleReviewed(vehicle.vin)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${wasReviewed ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}><CheckCircle2 size={14} />{wasReviewed ? 'Reviewed' : 'Mark reviewed'}</button></td>
                  </tr>
                  {open && <tr className="bg-gray-50/80 dark:bg-slate-950/70"><td colSpan={7} className="px-10 py-4"><div className="grid gap-4 lg:grid-cols-3"><div><h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">Open issues</h3><div className="mt-2 space-y-2">{vehicle.issues.length ? vehicle.issues.map((issue, index) => <div key={`${issue.category}-${index}`} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"><span className="text-xs font-semibold text-gray-500 dark:text-slate-400">{issue.category}</span><p className="text-sm text-gray-800 dark:text-slate-100">{issue.label}</p></div>) : <p className="text-sm text-emerald-700 dark:text-emerald-300">No exception in the available evidence.</p>}</div></div><div><h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">Documents</h3><dl className="mt-2 space-y-1 text-sm text-gray-700 dark:text-slate-200"><div><dt className="inline text-gray-500">Registration: </dt><dd className="inline">{vehicle.registrationNumber || 'Unavailable'} · {vehicle.registrationState || 'State unavailable'}</dd></div><div><dt className="inline text-gray-500">Registration expiry: </dt><dd className="inline">{vehicle.registrationExpiryDate || 'Permanent / unavailable'}</dd></div><div><dt className="inline text-gray-500">Ownership end: </dt><dd className="inline">{vehicle.ownershipEndDate || 'Unavailable'}</dd></div></dl></div><div><h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">Portal health</h3><div className="mt-2 flex flex-wrap gap-1">{Object.entries(vehicle.healthStatuses).map(([key, value]) => <span key={key} className={`rounded px-2 py-1 text-xs ${value === 'OPERATIONAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{pretty(key)}: {pretty(value)}</span>)}</div></div></div></td></tr>}
                </React.Fragment>;
              })}
            </tbody>
          </table>
        </div>
        {!filteredVehicles.length && <div className="p-10 text-center text-sm text-gray-500 dark:text-slate-400">No vehicles match the current filters.</div>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2"><Database size={18} className="text-blue-600" /><h2 className="font-semibold text-gray-900 dark:text-white">Evidence and source freshness</h2></div>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">This view reconciles frozen source snapshots. Refresh rereads local evidence; it does not claim a live Amazon or PAVE sync.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{data.sources.map((source) => <article key={source.label} className="rounded-lg bg-gray-50 p-3 dark:bg-slate-950"><strong className="block text-sm text-gray-900 dark:text-white">{source.label}</strong><span className="text-xs text-gray-500 dark:text-slate-400">As of {source.asOf}</span><span className="mt-1 block break-all text-[11px] text-gray-400">{source.path}</span></article>)}</div>
      </section>
    </div>
  );
};

export default FleetCompliancePage;
