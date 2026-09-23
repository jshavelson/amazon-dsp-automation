import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CircleHelp, LockKeyhole, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

const content = {
  settings: {
    icon: Settings,
    title: 'Settings',
    subtitle: 'Local dashboard preferences',
    items: [
      ['Theme', 'Use the sun/moon control in the header. Your preference is saved in this browser.'],
      ['Dashboard period', 'The Current / 6 weeks / 3 months selection is saved automatically.'],
      ['Financial privacy', 'The financial mask selection is saved automatically and persists across reloads.'],
    ],
  },
  security: {
    icon: LockKeyhole,
    title: 'Security',
    subtitle: 'Session and data-handling controls',
    items: [
      ['Session', 'This local environment uses development authentication. Production access remains identity-provider controlled.'],
      ['Financial masking', 'Use dashboard financial masking before sharing the screen or capturing screenshots.'],
      ['Dispute submissions', 'External dispute submissions remain owner-approval gated.'],
    ],
  },
  notifications: {
    icon: Bell,
    title: 'Notifications',
    subtitle: 'Current operational attention items',
    items: [['Loading source status', 'Current connection and source timestamps are being checked.']],
  },
  help: {
    icon: CircleHelp,
    title: 'Help & Support',
    subtitle: 'How to use the operating dashboard',
    items: [
      ['Dashboard', 'Use the period selector for current, six-week, or three-month trends; hover chart points for exact values.'],
      ['Weekly Evaluation', 'Choose a scorecard week to review executive analysis, driver rankings, and evidence-cleared dispute posture.'],
      ['Time & Attendance', 'Search and filter ADP missed-punch and unassigned-shift exceptions.'],
    ],
  },
} as const;

const SystemPage: React.FC = () => {
  const key = useLocation().pathname.slice(1) as keyof typeof content;
  const page = content[key] || content.help;
  const Icon = page.icon;
  const { data: operations } = useQuery<{ sources: Array<{ label: string; status: string; asOf?: string | null }>; fleet: { summary?: { operational?: number; registeredFleet?: number } }; performance: { period: string } }>({
    queryKey: ['dashboard-operations'], queryFn: () => api.get('/dashboard/operations'), enabled: key === 'notifications', staleTime: 60_000
  });
  const notificationItems: ReadonlyArray<readonly [string, string]> = operations ? [
    ['Fleet readiness', `${operations.fleet.summary?.operational || 0} of ${operations.fleet.summary?.registeredFleet || 0} vehicles are operational in the latest fleet evidence.`],
    ['Amazon scorecard', `Latest connected scorecard period: ${operations.performance.period}.`],
    ['Connection health', operations.sources.map((source) => `${source.label}: ${source.status}${source.asOf ? ` (${source.asOf})` : ''}`).join(' · ')],
  ] : page.items;
  const items = key === 'notifications' ? notificationItems : page.items;

  return <div className="space-y-6 pb-10">
    <section><p className="text-sm font-medium text-blue-600 dark:text-blue-400">System</p><h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{page.title}</h1><p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{page.subtitle}</p></section>
    <section className="grid gap-4 lg:grid-cols-3">{items.map(([title, detail]) => <article key={title} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800"><Icon className="text-blue-600 dark:text-blue-400" size={20} /><h2 className="mt-3 font-semibold text-gray-900 dark:text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-gray-500 dark:text-slate-400">{detail}</p></article>)}</section>
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><strong>Operational support:</strong> Use <Link className="underline" to="/dashboard">Dashboard</Link> for source freshness and management priorities, or <Link className="underline" to="/weekly-evaluation">Weekly Evaluation</Link> for scorecard-specific analysis.</section>
  </div>;
};

export default SystemPage;
