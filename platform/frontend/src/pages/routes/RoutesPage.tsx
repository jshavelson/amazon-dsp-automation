import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, Send, Truck } from 'lucide-react';
import { api } from '@/services/api';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { MetricCard } from '@/components/shared/OperationalSourceBanner';

type Risk = 'on_track' | 'late_departure' | 'behind' | 'stalled';
type DispatchAssignment = { driverId?: string; driverName?: string; vanId?: string; vanLabel?: string; vin?: string; phoneId?: string; phoneLabel?: string; pad?: string; stagingArea?: string };
type DispatchOption = { id: string; label: string; status?: string; source?: string; vin?: string };
type AdditionalTransporter = { transporterId: string; driverName: string; vin?: string; role: string; completedStops: number; totalStops: number; stopsLastHour: number };
type LiveRoute = { routeId: string; routeCode: string; deliveryDate: string; transporterId: string; driverName: string; status: string; risk: Risk; completedStops: number; totalStops: number; stopsLastHour: number; transporterCount?: number; additionalTransporters?: AdditionalTransporter[]; dispatchAssignment?: DispatchAssignment };
type Payload = {
  period: string | null; capturedAt: string | null; source: string; live: boolean; stale: boolean; needsData: boolean; needsReauth: boolean; message?: string; routeCount: number;
  summary: { assigned: number; inProgress: number; completed: number; behind: number; stalled: number; lateDepartures: number; multiRoute: number };
  dispatchPlan?: { expectedRoutes: number; sweepers: number };
  routes: LiveRoute[]; assignmentOptions?: { drivers: DispatchOption[]; vans: DispatchOption[]; phones: DispatchOption[] };
};

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const riskStyle: Record<Risk, string> = { on_track: 'bg-emerald-100 text-emerald-800', late_departure: 'bg-amber-100 text-amber-800', behind: 'bg-orange-100 text-orange-800', stalled: 'bg-red-100 text-red-800' };

const AssignmentSelect = ({ label, value, options, onChange, disabled }: { label: string; value: string; options: DispatchOption[]; onChange: (value: string) => void; disabled: boolean }) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full min-w-28 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"><option value="">Unassigned</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;

const AutoSaveText = ({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void; disabled?: boolean }) => {
  const [draft, setDraft] = useState(value);
  const onSaveRef = useRef(onSave);
  const focusedRef = useRef(false);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { if (!focusedRef.current) setDraft(value); }, [value]);
  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = window.setTimeout(() => onSaveRef.current(draft.trim()), 500);
    return () => window.clearTimeout(timer);
  }, [draft, value]);
  return <input aria-label={label} value={draft} onFocus={() => { focusedRef.current = true; }} onBlur={() => { focusedRef.current = false; }} onChange={(event) => setDraft(event.target.value)} className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-950" placeholder="—"/>;
};

const RoutesPage: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(today);
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState<'all' | Risk>('all');
  const [expectedRoutes, setExpectedRoutes] = useState(0);
  const [sweepers, setSweepers] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<Payload>({ queryKey: ['route-monitor-live', selectedDate], queryFn: () => api.get<Payload>('/route-monitor', { date: selectedDate }), refetchInterval: selectedDate === today() ? 5 * 60 * 1000 : false, staleTime: 60 * 1000 });
  const { refresh, isRefreshing, refreshError } = useDataRefresh();
  useEffect(() => { setExpectedRoutes(data?.dispatchPlan?.expectedRoutes || 0); setSweepers(data?.dispatchPlan?.sweepers || 0); }, [data?.period, data?.dispatchPlan?.expectedRoutes, data?.dispatchPlan?.sweepers]);
  useEffect(() => {
    if (!data || data.period !== selectedDate) return;
    const timer = window.setTimeout(async () => {
      await api.put('/route-monitor/plan', { deliveryDate: selectedDate, expectedRoutes, sweepers });
      setSaveMessage(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selectedDate, expectedRoutes, sweepers, data?.period]);
  const saveAssignment = useMutation({
    mutationFn: ({ route, assignment }: { route: LiveRoute; assignment: DispatchAssignment }) => api.put('/route-monitor/assignments', { deliveryDate: route.deliveryDate, routeId: route.routeId, routeCode: route.routeCode, transporterId: route.transporterId, driverId: assignment.driverId || '', vanId: assignment.vanId || '', phoneId: assignment.phoneId || '', pad: assignment.pad || '', stagingArea: assignment.stagingArea || '' }),
    onSuccess: (response, variables) => {
      const saved = (response as { assignment?: DispatchAssignment }).assignment || variables.assignment;
      queryClient.setQueryData<Payload>(['route-monitor-live', selectedDate], (current) => current ? {
        ...current,
        routes: current.routes.map((route) => route.routeCode === variables.route.routeCode
          ? { ...route, dispatchAssignment: { ...(route.dispatchAssignment || {}), ...saved } }
          : route),
      } : current);
      setSaveMessage('Assignment saved');
    },
    onError: (reason) => setSaveMessage(reason instanceof Error ? reason.message : 'Assignment could not be saved'),
  });
  const options = data?.assignmentOptions || { drivers: [], vans: [], phones: [] };
  const rows = useMemo(() => (data?.routes || []).filter((route) => (risk === 'all' || route.risk === risk) && `${route.routeCode} ${route.driverName} ${route.dispatchAssignment?.driverName || ''} ${route.dispatchAssignment?.vanLabel || ''}`.toLowerCase().includes(deferredSearch)), [data?.routes, risk, deferredSearch]);
  const additionalDrivers = useMemo(() => (data?.routes || []).flatMap((route) => (route.additionalTransporters || []).map((driver) => ({ ...driver, routeCode: route.routeCode }))), [data?.routes]);
  const ready = (data?.routes || []).filter((route) => route.dispatchAssignment?.driverId && route.dispatchAssignment?.vanId && route.dispatchAssignment?.phoneId).length;
  const updateAssignment = (route: LiveRoute, patch: DispatchAssignment) => saveAssignment.mutate({ route, assignment: { ...(route.dispatchAssignment || {}), ...patch } });
  const shareAssignments = async () => {
    const lines = (data?.routes || []).filter((route) => route.dispatchAssignment?.driverName).map((route) => { const a = route.dispatchAssignment || {}; return `${route.routeCode}: ${a.driverName} · ${a.vanLabel || 'No van'} · ${a.phoneLabel || 'No phone'} · PAD ${a.pad || '—'} · Stage ${a.stagingArea || '—'}`; });
    const text = [`JECS dispatch assignments · ${selectedDate}`, `Expected routes: ${expectedRoutes} · Sweepers: ${sweepers}`, ...lines].join('\n');
    try {
      if (navigator.share) { await navigator.share({ title: `Dispatch assignments ${selectedDate}`, text }); setSaveMessage('Assignment sheet opened for sharing'); }
      else { await navigator.clipboard.writeText(text); setSaveMessage('Assignments copied—paste into SMS or WhatsApp'); }
    } catch { setSaveMessage('Sharing cancelled'); }
  };

  if (isLoading) return <div className="rounded-xl border bg-white p-8">Loading dispatch plan…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Dispatch plan could not be loaded. <button className="underline" onClick={() => refetch()}>Retry</button></div>;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold dark:text-white">Live Route Monitor</h1><p className="text-sm text-gray-500">Morning dispatch plan + Cortex progress</p></div><div className="flex flex-wrap items-center gap-2"><input aria-label="Dispatch date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"/><button type="button" onClick={() => void refresh()} disabled={isRefreshing} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''}/>{isRefreshing ? 'Refreshing…' : 'Refresh Cortex'}</button><button type="button" onClick={() => void shareAssignments()} className="flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white"><Send size={15}/>Text / share</button></div></header>
    <div className={`rounded-lg border p-3 text-sm ${data?.live ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><div className="flex items-center gap-2 font-semibold">{data?.live ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>} {data?.live ? 'Live Cortex data' : data?.capturedAt ? 'Cortex data is stale' : 'No Cortex capture for this date'}</div><p className="mt-1">{data?.message}</p>{data?.needsReauth && <p className="mt-1 font-semibold">Reconnect Amazon on Connections to refresh portal data.</p>}{refreshError && <p className="mt-1 text-red-700">{refreshError.message}</p>}</div>
    <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-900"><label className="text-xs font-semibold text-gray-600">Expected routes<input type="number" min="0" max="250" value={expectedRoutes} onChange={(event) => setExpectedRoutes(Number(event.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-base dark:border-slate-700 dark:bg-slate-950"/></label><label className="text-xs font-semibold text-gray-600">Sweepers<input type="number" min="0" max="100" value={sweepers} onChange={(event) => setSweepers(Number(event.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-base dark:border-slate-700 dark:bg-slate-950"/></label><MetricCard label="Cortex routes" value={data?.routeCount || 0}/><MetricCard label="Dispatch ready" value={`${ready}/${data?.routeCount || 0}`}/><MetricCard label="Behind / stalled" value={`${data?.summary.behind || 0} / ${data?.summary.stalled || 0}`}/><MetricCard label="Auto save" value={saveMessage || 'Ready'}/></section>
    {options.drivers.length === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No named active drivers are available from the selected Amazon portal capture. Reconnect and refresh Cortex; the dropdown no longer mixes in ADP or scorecard drivers.</div>}
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex gap-2 border-b p-3 dark:border-slate-800"><label className="relative flex-1"><Search className="absolute left-2.5 top-2 text-gray-400" size={15}/><input aria-label="Search routes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Route, driver, or van" className="w-full rounded border py-1.5 pl-8 pr-2 text-sm dark:border-slate-700 dark:bg-slate-950"/></label><select aria-label="Risk filter" value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)} className="rounded border px-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="all">All</option><option value="stalled">Stalled</option><option value="behind">Behind</option><option value="late_departure">Late</option><option value="on_track">On track</option></select></div>
      {rows.length === 0 ? <div className="p-8 text-center text-gray-500"><Truck className="mx-auto mb-2"/><strong>No Cortex routes for {selectedDate}</strong><p className="mt-1 text-sm">Expected route and sweeper counts above still save by date.</p></div> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-left uppercase text-gray-500 dark:bg-slate-800"><tr><th className="px-2 py-2">Route</th><th className="px-2 py-2">Driver</th><th className="px-2 py-2">Van</th><th className="px-2 py-2">Stops / pace</th><th className="px-2 py-2">Phone</th><th className="px-2 py-2">PAD</th><th className="px-2 py-2">Staging</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{rows.map((route) => { const assignment = route.dispatchAssignment || {}; const saving = saveAssignment.isPending && saveAssignment.variables?.route.routeCode === route.routeCode; return <tr key={route.routeCode}><td className="px-2 py-1.5"><div className="font-bold text-sm">{route.routeCode}</div><span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${riskStyle[route.risk]}`}>{route.risk.replace('_', ' ')}</span>{(route.transporterCount || 1) > 1 && <div className="mt-1 text-[9px] text-purple-700">{route.transporterCount} transporters</div>}</td><td className="px-2 py-1.5"><AssignmentSelect label={`Driver for ${route.routeCode}`} value={assignment.driverId || ''} options={options.drivers} disabled={saving} onChange={(driverId) => updateAssignment(route, { driverId })}/></td><td className="px-2 py-1.5"><AssignmentSelect label={`Van for ${route.routeCode}`} value={assignment.vanId || ''} options={options.vans} disabled={saving} onChange={(vanId) => updateAssignment(route, { vanId })}/></td><td className="whitespace-nowrap px-2 py-1.5"><strong>{route.completedStops}/{route.totalStops}</strong><br/><span className="text-gray-500">{route.stopsLastHour}/hr</span></td><td className="px-2 py-1.5"><AssignmentSelect label={`Phone for ${route.routeCode}`} value={assignment.phoneId || ''} options={options.phones} disabled={saving} onChange={(phoneId) => updateAssignment(route, { phoneId })}/></td><td className="px-2 py-1.5"><AutoSaveText label={`PAD for ${route.routeCode}`} value={assignment.pad || ''} disabled={saving} onSave={(pad) => updateAssignment(route, { pad })}/></td><td className="px-2 py-1.5"><AutoSaveText label={`Staging area for ${route.routeCode}`} value={assignment.stagingArea || ''} disabled={saving} onSave={(stagingArea) => updateAssignment(route, { stagingArea })}/></td></tr>; })}</tbody></table></div>}
      <p className="border-t px-3 py-2 text-[11px] text-gray-500 dark:border-slate-800">{rows.length} unique route numbers · one primary driver per route · assignments auto-save by date</p></section>
    {additionalDrivers.length > 0 && <section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="border-b px-3 py-2 dark:border-slate-800"><h2 className="font-semibold dark:text-white">Additional drivers, rescuers & sweepers</h2><p className="text-xs text-gray-500">Shown separately from the primary route assignment.</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-left uppercase text-gray-500 dark:bg-slate-800"><tr><th className="px-3 py-2">Route</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Stops / pace</th><th className="px-3 py-2">Van / VIN</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{additionalDrivers.map((driver) => <tr key={`${driver.routeCode}-${driver.transporterId}`}><td className="px-3 py-2 font-bold">{driver.routeCode}</td><td className="px-3 py-2"><span className="font-medium">{driver.driverName || 'Name unavailable'}</span><span className="block text-[10px] text-gray-500">{driver.transporterId}</span></td><td className="px-3 py-2">{driver.role}</td><td className="px-3 py-2 whitespace-nowrap">{driver.completedStops}/{driver.totalStops} · {driver.stopsLastHour}/hr</td><td className="px-3 py-2 font-mono text-[10px]">{driver.vin || '—'}</td></tr>)}</tbody></table></div></section>}
  </div>;
};

export default RoutesPage;
