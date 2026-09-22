import React from 'react';
import { Link } from 'react-router-dom';
import { Database, ExternalLink } from 'lucide-react';

export const OperationalSourceBanner: React.FC<{ source: string; detail: string }> = ({ source, detail }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
    <div className="flex items-start gap-2"><Database size={17} className="mt-0.5 shrink-0" /><div><strong>{source}</strong><p className="mt-0.5 text-xs text-blue-800 dark:text-blue-300">{detail}</p></div></div>
    <Link to="/connections" className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-blue-700 hover:underline dark:text-blue-300">Manage source <ExternalLink size={13} /></Link>
  </div>
);

export const MetricCard: React.FC<{ label: string; value: React.ReactNode; detail?: string }> = ({ label, value, detail }) => (
  <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{value}</p>{detail && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{detail}</p>}</article>
);
