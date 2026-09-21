import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock3, Search } from 'lucide-react';
import { api } from '@/services/api';

interface AttendanceException {
  employee: string;
  date: string;
  issueType: string;
  details: string;
}

interface AttendanceResponse {
  sourcePeriod: string;
  capturedAt: string;
  exceptions: AttendanceException[];
}

const TimeAttendancePage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [issue, setIssue] = useState('all');
  const { data, isLoading, error } = useQuery({ queryKey: ['time-attendance-exceptions'], queryFn: () => api.get<AttendanceResponse>('/time-attendance/exceptions') });
  const rows = useMemo(() => (data?.exceptions || []).filter((row) => (issue === 'all' || row.issueType === issue) && `${row.employee} ${row.date} ${row.details}`.toLowerCase().includes(query.toLowerCase())), [data, issue, query]);

  return <div className="space-y-6 pb-10">
    <section><p className="text-sm font-medium text-blue-600 dark:text-blue-400">Administration · incumbent capability restored</p><h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Time & Attendance</h1><p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Missed punches, unassigned shifts, and shifts exceeding 10 hours for active delivery associates.</p></section>
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><strong>Data source:</strong> Latest ADP timecard snapshot {data ? `(${data.sourcePeriod}; captured ${data.capturedAt})` : ''}. Only active delivery associates are shown.</section>
    <section className="grid gap-4 sm:grid-cols-3"><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><Clock3 className="text-blue-600" size={20} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Total exceptions</p><p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{data?.exceptions.length || 0}</p></article><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><AlertTriangle className="text-amber-600" size={20} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Missed punches</p><p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{data?.exceptions.filter((row) => row.issueType === 'Missed punch').length || 0}</p></article><article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><AlertTriangle className="text-violet-600" size={20} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Unassigned shifts</p><p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{data?.exceptions.filter((row) => row.issueType === 'Unassigned shift').length || 0}</p></article></section>
    <section className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><div className="flex flex-wrap gap-3 border-b border-gray-100 p-4 dark:border-slate-800"><label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 text-gray-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employee, date, or details" className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label><select value={issue} onChange={(event) => setIssue(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="all">All issue types</option><option value="Missed punch">Missed punch</option><option value="Unassigned shift">Unassigned shift</option></select></div>{isLoading ? <div className="p-6 text-sm text-gray-500">Loading exceptions…</div> : error ? <div className="p-6 text-red-700">Attendance exceptions could not be loaded.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950/60 dark:text-slate-400"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Issue type</th><th className="px-4 py-3">Details</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-slate-800">{rows.map((row) => <tr key={`${row.employee}-${row.date}`}><td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.employee}</td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{row.date}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.issueType === 'Missed punch' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>{row.issueType}</span></td><td className="px-4 py-3 text-gray-600 dark:text-slate-300">{row.details}</td></tr>)}</tbody></table></div>}</section>
  </div>;
};

export default TimeAttendancePage;
