import React, { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Search, Truck } from 'lucide-react';
import { api } from '@/services/api';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { MetricCard } from '@/components/shared/OperationalSourceBanner';

type Risk = 'on_track' | 'late_departure' | 'behind' | 'stalled';
type DispatchAssignment = { driverId?: string; driverName?: string; vanId?: string; vanLabel?: string; vin?: string; phoneId?: string; phoneLabel?: string; updatedAt?: string };
type DispatchOption = { id: string; label: string; status?: string; source?: string; vin?: string };
type LiveRoute = {
  routeId: string; routeCode: string; deliveryDate: string; transporterId: string; driverName: string; vin: string;
  status: string; risk: Risk; completedStops: number; totalStops: number; completionPct: number;
  deliveredPackages: number; totalPackages: number; stopsLastHour: number; projectedCompletionAt: string | null;
  projectedLateMinutes: number; inactiveMinutes: number; onBreak: boolean; routePaused: boolean; rescueCount: number;
  associatedRoutes: { routeCode: string }[]; isMultiRoute: boolean; dispatchAssignment?: DispatchAssignment;
};
type Payload = {
  period: string | null; capturedAt: string | null; source: string; live: boolean; stale: boolean; needsData: boolean;
  needsReauth: boolean; message?: string; routeCount: number;
  summary: { assigned: number; inProgress: number; completed: number; behind: number; stalled: number; lateDepartures: number; multiRoute: number };
  routes: LiveRoute[]; assignmentOptions?: { drivers: DispatchOption[]; vans: DispatchOption[]; phones: DispatchOption[] };
};

const riskStyle: Record<Risk, string> = { on_track: 'bg-emerald-100 text-emerald-800', late_departure: 'bg-amber-100 text-amber-800', behind: 'bg-orange-100 text-orange-800', stalled: 'bg-red-100 text-red-800' };
const time = (value: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const routeKey = (route: LiveRoute) => `${route.routeId}|${route.transporterId}`;

const AssignmentSelect = ({ label, value, options, onChange, disabled }: { label: string; value: string; options: DispatchOption[]; onChange: (value: string) => void; disabled: boolean }) => <label className="block">
  <span className="sr-only">{label}</span>
  <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full min-w-36 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950">
    <option value="">Unassigned</option>
    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>
</label>;

const RoutesPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState<'all' | Risk>('all');
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<Payload>({ queryKey: ['route-monitor-live'], queryFn: () => api.get<Payload>('/route-monitor'), refetchInterval: 5 * 60 * 1000, staleTime: 4 * 60 * 1000 });
  const { refresh, isRefreshing, refreshError } = useDataRefresh();
  const saveAssignment = useMutation({
    mutationFn: ({ route, assignment }: { route: LiveRoute; assignment: DispatchAssignment }) => api.put('/route-monitor/assignments', { deliveryDate: route.deliveryDate, routeId: route.routeId, transporterId: route.transporterId, driverId: assignment.driverId || '', vanId: assignment.vanId || '', phoneId: assignment.phoneId || '' }),
    onSuccess: async () => { setAssignmentError(null); await queryClient.invalidateQueries({ queryKey: ['route-monitor-live'] }); },
    onError: (reason) => setAssignmentError(reason instanceof Error ? reason.message : 'Assignment could not be saved.'),
  });
  const options = data?.assignmentOptions || { drivers: [], vans: [], phones: [] };
  const searchableRoutes = useMemo(() => (data?.routes || []).map((route) => ({ route, searchText: `${route.driverName} ${route.transporterId} ${route.routeCode} ${route.vin} ${route.dispatchAssignment?.driverName || ''} ${route.dispatchAssignment?.vanLabel || ''} ${route.dispatchAssignment?.phoneLabel || ''}`.toLowerCase() })), [data?.routes]);
  const rows = useMemo(() => searchableRoutes.filter(({ route, searchText }) => (risk === 'all' || route.risk === risk) && searchText.includes(deferredSearch)).map(({ route }) => route), [searchableRoutes, risk, deferredSearch]);
  const assignedRoutes = (data?.routes || []).filter((route) => route.dispatchAssignment?.driverId && route.dispatchAssignment?.vanId && route.dispatchAssignment?.phoneId).length;
  const updateAssignment = (route: LiveRoute, patch: DispatchAssignment) => saveAssignment.mutate({ route, assignment: { ...(route.dispatchAssignment || {}), ...patch } });

  if (isLoading) return <div className="rounded-xl border bg-white p-8">Loading live routes…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Live routes could not be loaded. <button className="underline" onClick={() => refetch()}>Retry</button></div>;
  const age = data?.capturedAt ? Math.max(0, Math.round((Date.now() - Date.parse(data.capturedAt)) / 60000)) : null;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold dark:text-white">Live Route Monitor</h1><p className="text-sm text-gray-500">Cortex / Amazon Delivery Execution · {data?.period || 'no operating day loaded'}</p></div><button type="button" onClick={() => void refresh()} disabled={isRefreshing} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50"><RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''}/>{isRefreshing ? 'Refreshing Cortex…' : 'Refresh Cortex'}</button></header>
    <div className={`rounded-xl border p-4 ${data?.live ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : data?.stale && data?.capturedAt ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-800'}`}><div className="flex items-center gap-2 font-semibold">{data?.live ? <><span className="h-2.5 w-2.5 rounded-full bg-emerald-500"/>Live Cortex data</> : <><AlertTriangle size={17}/>{data?.capturedAt ? 'Cortex data is stale' : 'Cortex is not connected'}</>}</div><p className="mt-1 text-sm">{data?.message || `${data?.routeCount || 0} route assignments captured ${age === null ? 'at an unknown time' : `${age} minute${age === 1 ? '' : 's'} ago`}. Auto-refreshes every five minutes.`}</p>{data?.needsReauth && <p className="mt-2 text-sm font-semibold">Reconnect Amazon on the Connections screen to restore live Cortex updates.</p>}{refreshError && <p className="mt-2 text-sm font-semibold text-red-700">{refreshError.message}</p>}</div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><MetricCard label="Routes" value={data?.routeCount || 0}/><MetricCard label="Dispatch ready" value={`${assignedRoutes}/${data?.routeCount || 0}`} detail="driver + van + phone"/><MetricCard label="In progress" value={data?.summary.inProgress || 0}/><MetricCard label="Behind" value={data?.summary.behind || 0}/><MetricCard label="Stalled" value={data?.summary.stalled || 0}/><MetricCard label="Completed" value={data?.summary.completed || 0}/></div>
    {assignmentError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{assignmentError}</div>}
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap gap-3 border-b p-4 dark:border-slate-800"><label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 text-gray-400" size={16}/><input aria-label="Search live routes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, route, van, phone, transporter, or VIN" className="w-full rounded-lg border py-2 pl-9 pr-3 dark:border-slate-700 dark:bg-slate-950"/></label><select aria-label="Risk filter" value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)} className="rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-950"><option value="all">All conditions</option><option value="stalled">Stalled</option><option value="behind">Behind</option><option value="late_departure">Late departure</option><option value="on_track">On track</option></select></div>
      {rows.length === 0 ? <div className="p-10 text-center text-gray-500"><Truck className="mx-auto mb-3"/><p className="font-medium">No live routes to display</p><p className="mt-1 text-sm">Refresh Cortex after routes are published for today.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-slate-800"><tr><th className="p-3">Cortex route</th><th className="p-3">Condition</th><th className="p-3">Stops / pace</th><th className="p-3">Driver assignment</th><th className="p-3">Van assignment</th><th className="p-3">Phone assignment</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{rows.map((route) => {
        const assignment = route.dispatchAssignment || {};
        const saving = saveAssignment.isPending && saveAssignment.variables?.route && routeKey(saveAssignment.variables.route) === routeKey(route);
        const ready = assignment.driverId && assignment.vanId && assignment.phoneId;
        return <tr key={routeKey(route)} className={route.risk === 'stalled' ? 'bg-red-50/60' : ''}><td className="p-3"><div className="flex items-center gap-2"><span className="font-semibold dark:text-white">{route.routeCode}</span>{ready && <CheckCircle2 size={15} className="text-emerald-600"/>}</div><div className="text-xs text-gray-500">{route.driverName || route.transporterId || 'Cortex driver unassigned'}</div>{route.isMultiRoute && <div className="mt-1 text-xs text-blue-700">Multi-route: {route.associatedRoutes.map((item) => item.routeCode).join(', ')}</div>}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${riskStyle[route.risk]}`}>{route.risk.replace('_', ' ')}</span>{route.onBreak && <div className="mt-1 text-xs text-gray-500">On break</div>}{route.routePaused && <div className="mt-1 text-xs text-red-600">Route paused</div>}</td><td className="p-3"><div className="font-semibold">{route.completedStops}/{route.totalStops} stops</div><div>{route.stopsLastHour} stops/hr</div><div className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Clock3 size={13}/>{time(route.projectedCompletionAt)}</div></td><td className="p-3"><AssignmentSelect label={`Driver for ${route.routeCode}`} value={assignment.driverId || ''} options={options.drivers} disabled={Boolean(saving)} onChange={(driverId) => updateAssignment(route, { driverId })}/></td><td className="p-3"><AssignmentSelect label={`Van for ${route.routeCode}`} value={assignment.vanId || ''} options={options.vans} disabled={Boolean(saving)} onChange={(vanId) => updateAssignment(route, { vanId })}/>{assignment.vin && <div className="mt-1 font-mono text-[10px] text-gray-500">{assignment.vin}</div>}</td><td className="p-3"><AssignmentSelect label={`Phone for ${route.routeCode}`} value={assignment.phoneId || ''} options={options.phones} disabled={Boolean(saving)} onChange={(phoneId) => updateAssignment(route, { phoneId })}/>{saving && <div className="mt-1 text-[10px] text-blue-600">Saving…</div>}</td></tr>;
      })}</tbody></table></div>}
      <p className="border-t p-3 text-xs text-gray-500 dark:border-slate-800">Showing {rows.length} routes · Dispatch assignments save immediately · Source: {data?.source}</p></section>
  </div>;
};

export default RoutesPage;
