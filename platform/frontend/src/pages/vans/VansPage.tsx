import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Truck } from 'lucide-react';
import { api } from '@/services/api';
import { MetricCard, OperationalSourceBanner } from '@/components/shared/OperationalSourceBanner';

type Van = { id: string; van_number: string; vin: string; make: string; model: string; year: number; status: string; ownership: string };
type VanApiRow = Partial<Van> & { licensePlate?: string; unit?: string; operationalStatus?: string };
type VanApiResponse = VanApiRow[] | { data?: VanApiRow[]; items?: VanApiRow[] };

export const normalizeVans = (response: VanApiResponse): Van[] => {
  const rows = Array.isArray(response) ? response : response.data || response.items || [];
  return rows.map((van, index) => ({
    id: String(van.id || van.vin || `van-${index + 1}`),
    van_number: String(van.van_number || van.unit || van.licensePlate || van.vin?.slice(-7) || 'Unassigned'),
    vin: String(van.vin || ''),
    make: String(van.make || ''),
    model: String(van.model || ''),
    year: Number(van.year || 0),
    status: String(van.status || van.operationalStatus || 'UNKNOWN').toUpperCase(),
    ownership: String(van.ownership || 'UNKNOWN').toUpperCase(),
  }));
};

const VansPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [ownership, setOwnership] = useState('all');
  const { data = [], isLoading, error, refetch } = useQuery<Van[]>({
    queryKey: ['operational-vans'],
    queryFn: async () => normalizeVans(await api.get<VanApiResponse>('/vans')),
  });
  const ownerships = useMemo(() => [...new Set(data.map(v => v.ownership))].sort(), [data]);
  const rows = useMemo(() => data.filter(v => {
    const q = search.toLowerCase();
    return (ownership === 'all' || v.ownership === ownership) && (!q || `${v.van_number} ${v.vin} ${v.make} ${v.model}`.toLowerCase().includes(q));
  }), [data, search, ownership]);
  const operational = data.filter(v => v.status === 'OPERATIONAL').length;
  const amazonOwned = data.filter(v => v.ownership === 'AMAZON_OWNED').length;
  if (isLoading) return <div className="rounded-xl border bg-white p-8">Loading fleet…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Fleet could not be loaded. <button className="underline" onClick={() => refetch()}>Retry</button></div>;
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold dark:text-white">Vans</h1><p className="text-sm text-gray-500 dark:text-slate-400">Operational vehicle roster with ownership and readiness status.</p></header>
    <OperationalSourceBanner source="Amazon Fleet Portal + PAVE" detail="Amazon supplies the roster and ownership data. PAVE is a separate connection for assessments, inspections, and wear-and-tear evidence." />
    <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Fleet size" value={data.length} /><MetricCard label="Operational" value={operational} detail={`${data.length ? Math.round(operational / data.length * 100) : 0}% ready`} /><MetricCard label="Amazon owned" value={amazonOwned} detail={`${data.length - amazonOwned} non-Amazon vehicles`} /></div>
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap gap-3 border-b p-4 dark:border-slate-800"><label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 text-gray-400" size={16}/><input aria-label="Search fleet" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search van number, VIN, make or model" className="w-full rounded-lg border py-2 pl-9 pr-3 dark:border-slate-700 dark:bg-slate-950"/></label><select aria-label="Ownership" value={ownership} onChange={e=>setOwnership(e.target.value)} className="rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"><option value="all">All ownership</option>{ownerships.map(x=><option key={x}>{x}</option>)}</select></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-slate-800"><tr><th className="p-3">Van</th><th className="p-3">VIN</th><th className="p-3">Vehicle</th><th className="p-3">Ownership</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{rows.map(v=><tr key={v.id}><td className="p-3 font-semibold dark:text-white"><span className="inline-flex items-center gap-2"><Truck size={15}/>{v.van_number}</span></td><td className="p-3 font-mono text-xs text-gray-600 dark:text-slate-300">{v.vin}</td><td className="p-3 dark:text-slate-200">{v.year} {v.make} {v.model}</td><td className="p-3 text-xs dark:text-slate-300">{v.ownership.replaceAll('_',' ')}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${v.status==='OPERATIONAL'?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}`}>{v.status}</span></td></tr>)}</tbody></table></div>
      <p className="border-t p-3 text-xs text-gray-500 dark:border-slate-800">Showing {rows.length} of {data.length} vehicles</p>
    </section>
  </div>;
};
export default VansPage;
