import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSearch, ShieldAlert, Users } from 'lucide-react';
import { api } from '@/services/api';

interface EvaluationMetrics {
  rating: string;
  averageScore: number | null;
  activeDAs: number | null;
  packages: number | null;
  dcr: number | null;
  pod: number | null;
  cdf: number | null;
  dsb: number | null;
  failedPickups: number | null;
  safety: number | null;
  dvicAverage: number | null;
  sentiment: number | null;
  capacityReliability: string;
  casCompliance: string;
  tenuredWorkforce: string;
}

interface RankedDriver {
  name: string;
  standing: string;
  score: string;
  packages: string;
  pod: string;
  cdf: string;
  dsb: string;
}

interface DisputeCandidate {
  priority: number;
  submissionKey: string;
  status: string;
  driverName: string;
  metric: string;
  reason: string;
  appealedWeek: string;
  tba_ids: string[];
  appealDetails: string;
  evidenceSources: string[];
  evidenceStatus: string;
  blockingIssue: string | null;
}

interface WeeklyEvaluation {
  week: string;
  summary: string;
  disputeRead: string;
  coachingLanes: string;
  metrics: EvaluationMetrics;
  topDrivers: RankedDriver[];
  bottomDrivers: RankedDriver[];
  candidates: DisputeCandidate[];
}

interface WeeklyEvaluationResponse {
  weeks: string[];
  evaluations: Record<string, WeeklyEvaluation>;
}

const format = (value: number | null, digits = 0) => value == null
  ? 'Unavailable'
  : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const metricCards = (metrics: EvaluationMetrics) => [
  ['Paid rating', metrics.rating],
  ['Average DA score', format(metrics.averageScore, 2)],
  ['Active DAs', format(metrics.activeDAs)],
  ['Packages delivered', format(metrics.packages)],
  ['DCR', metrics.dcr == null ? 'Unavailable' : `${format(metrics.dcr, 2)}%`],
  ['POD', metrics.pod == null ? 'Unavailable' : `${format(metrics.pod, 2)}%`],
  ['CDF negatives', format(metrics.cdf)],
  ['DSB defects', format(metrics.dsb)],
  ['Failed pickup stops', format(metrics.failedPickups)],
  ['Safety events', format(metrics.safety)],
  ['Average DVIC', metrics.dvicAverage == null ? 'Unavailable' : `${format(metrics.dvicAverage, 1)} sec`],
  ['Driver sentiment', metrics.sentiment == null ? 'Unavailable' : `${format(metrics.sentiment, 1)}%`],
];

const DriverRanking: React.FC<{ title: string; rows: RankedDriver[]; watch?: boolean }> = ({ title, rows, watch }) => (
  <article className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800">
    <div className="border-b border-gray-100 px-5 py-4 dark:border-slate-800"><h2 className="font-semibold text-gray-900 dark:text-white">{title}</h2></div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[660px] text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950/60 dark:text-slate-400"><tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Overall</th><th className="px-4 py-3">Packages</th><th className="px-4 py-3">POD</th><th className="px-4 py-3">CDF DPMO</th><th className="px-4 py-3">DSB</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{rows.map((row, index) => <tr key={`${row.name}-${index}`} className="text-gray-700 dark:text-slate-200"><td className="px-4 py-3"><span className={`inline-grid h-7 w-7 place-items-center rounded-lg font-bold ${watch ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>{index + 1}</span></td><td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.name}<span className="block text-xs font-normal text-gray-500">{row.standing}</span></td><td className="px-4 py-3 font-semibold">{row.score}</td><td className="px-4 py-3">{row.packages || 'N/A'}</td><td className="px-4 py-3">{row.pod || 'N/A'}</td><td className="px-4 py-3">{row.cdf || 'N/A'}</td><td className="px-4 py-3">{row.dsb || 'N/A'}</td></tr>)}</tbody>
      </table>
    </div>
  </article>
);

const WeeklyEvaluationPage: React.FC = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['weekly-evaluations'],
    queryFn: () => api.get<WeeklyEvaluationResponse>('/weekly-evaluations'),
  });
  const [selectedWeek, setSelectedWeek] = useState<string>('');
  const activeWeek = selectedWeek || data?.weeks[0] || '';
  const evaluation = activeWeek ? data?.evaluations[activeWeek] : undefined;
  const coachingItems = useMemo(() => evaluation?.coachingLanes.split('•').map((item) => item.trim()).filter(Boolean) || [], [evaluation]);

  if (isLoading) return <div className="rounded-xl bg-white p-6 text-sm text-gray-500 shadow-card dark:bg-slate-900 dark:text-slate-400">Loading weekly evaluations…</div>;
  if (error || !evaluation) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">Weekly evaluations could not be loaded.</div>;

  return <div className="space-y-6 pb-10">
    <section className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-blue-600 dark:text-blue-400">Performance · incumbent capability restored</p><h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Weekly Evaluation</h1><p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Executive analysis, ranked drivers, dispute posture, and coaching lanes.</p></div><label className="text-sm font-medium text-gray-700 dark:text-slate-200">Scorecard week<select value={activeWeek} onChange={(event) => setSelectedWeek(event.target.value)} className="mt-1 block min-w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">{data?.weeks.map((week, index) => <option key={week} value={week}>{week}{index === 0 ? ' · latest' : ''}</option>)}</select></label></section>

    <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex gap-3"><FileSearch className="mt-0.5 shrink-0 text-blue-600" size={20} /><div><h2 className="font-semibold text-gray-900 dark:text-white">Weekly executive summary</h2><p className="mt-2 leading-6 text-gray-600 dark:text-slate-300">{evaluation.summary}</p></div></div></section>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{metricCards(evaluation.metrics).map(([label, value]) => <article key={label} className="rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{value}</p></article>)}</section>
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><strong>Supplementary scorecard:</strong> Capacity reliability: {evaluation.metrics.capacityReliability} · CAS compliance: {evaluation.metrics.casCompliance} · Tenured workforce: {evaluation.metrics.tenuredWorkforce}. Missing reports remain unavailable and are not treated as zero.</section>
    <section className="grid gap-4 xl:grid-cols-2"><DriverRanking title={`${activeWeek} · top 10 drivers`} rows={evaluation.topDrivers} /><DriverRanking title={`${activeWeek} · bottom 10 drivers`} rows={evaluation.bottomDrivers} watch /></section>

    <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex gap-3"><ShieldAlert className="shrink-0 text-amber-600" size={20} /><div><h2 className="font-semibold text-gray-900 dark:text-white">Executive dispute read</h2><p className="mt-2 leading-6 text-gray-600 dark:text-slate-300">{evaluation.disputeRead}</p></div></div></article><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex gap-3"><Users className="shrink-0 text-blue-600" size={20} /><div><h2 className="font-semibold text-gray-900 dark:text-white">Do not file / coaching-first lanes</h2><ul className="mt-3 space-y-3 text-sm leading-5 text-gray-600 dark:text-slate-300">{coachingItems.map((item) => <li key={item} className="flex gap-2"><AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={15} /><span>{item}</span></li>)}</ul></div></div></article></section>

    <section><div className="mb-3"><h2 className="text-lg font-semibold text-gray-900 dark:text-white">Evidence-cleared dispute candidates</h2><p className="text-sm text-gray-500 dark:text-slate-400">Submission remains owner-approval gated.</p></div>{evaluation.candidates.length ? <div className="space-y-4">{evaluation.candidates.map((candidate) => <article key={candidate.submissionKey} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-gray-900 dark:text-white">{candidate.driverName} · {candidate.metric}</h3><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Priority {candidate.priority}</span></div><p className="mt-2 text-sm text-gray-500 dark:text-slate-400">{candidate.reason} · {candidate.appealedWeek} · {candidate.tba_ids.length} TBA{candidate.tba_ids.length === 1 ? '' : 's'}</p><p className="mt-3 max-w-4xl text-sm leading-6 text-gray-600 dark:text-slate-300">{candidate.appealDetails}</p><p className="mt-3 font-mono text-xs text-blue-700 dark:text-blue-300">{candidate.tba_ids.join(' · ')}</p></div><span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><CheckCircle2 size={16} />Ready for review</span></div></article>)}</div> : <div className="rounded-xl bg-white p-6 text-center text-gray-500 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">No evidence-cleared dispute candidates for {activeWeek}. The week remains coaching-first.</div>}</section>

    <section><h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">Weekly management priorities</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[
      ['Customer delivery accuracy', 'Focus coaching on wrong-address and instruction-following complaints, then audit exception-stop POD behavior.'],
      ['DCR process control', 'Review concentrated RTS outliers and file only evidence-backed disputes.'],
      ['Safety follow-up', 'Review every event and confirm approved disputes are reflected before coaching.'],
      ['DVIC discipline', 'Use inspection duration and completion evidence to prevent rushed pre-trip checks.'],
    ].map(([title, detail]) => <article key={title} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3><p className="mt-2 text-sm leading-5 text-gray-500 dark:text-slate-400">{detail}</p></article>)}</div></section>
  </div>;
};

export default WeeklyEvaluationPage;
