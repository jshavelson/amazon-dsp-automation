import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/services/api';
import { MetricCard, OperationalSourceBanner } from '@/components/shared/OperationalSourceBanner';

type RouteRow = { route_code: string; driver_id: string; driver_name: string; date: string; stops: number|null; packages: number; status: string; overall_score:number|null; pod:number|null; cdf:number|null; dsb:number|null };
type Payload = { period:string; routes:RouteRow[]; routeCount:number; source:string };

const RoutesPage: React.FC = () => {
  const [search,setSearch]=useState('');
  const {data,isLoading,error,refetch}=useQuery<Payload>({queryKey:['route-monitor-live'],queryFn:()=>api.get<Payload>('/route-monitor')});
  const routes=data?.routes||[];
  const rows=useMemo(()=>routes.filter(r=>`${r.driver_name} ${r.route_code}`.toLowerCase().includes(search.toLowerCase())),[routes,search]);
  const packages=routes.reduce((n,r)=>n+(r.packages||0),0);
  const scored=routes.filter(r=>r.overall_score!=null);
  const avg=scored.length?scored.reduce((n,r)=>n+Number(r.overall_score),0)/scored.length:0;
  if(isLoading)return <div className="rounded-xl border bg-white p-8">Loading routes…</div>;
  if(error)return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Routes could not be loaded. <button className="underline" onClick={()=>refetch()}>Retry</button></div>;
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold dark:text-white">Route Monitor</h1><p className="text-sm text-gray-500">Latest available Amazon route-performance period: {data?.period||'none'}.</p></header>
    <OperationalSourceBanner source="Amazon Logistics" detail="Weekly route aggregates are available. Connect the live Amazon session to add same-day route progress and exceptions." />
    <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Drivers/routes" value={routes.length}/><MetricCard label="Packages" value={packages.toLocaleString()}/><MetricCard label="Average score" value={avg?`${avg.toFixed(1)}%`:'—'}/></div>
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="border-b p-4 dark:border-slate-800"><label className="relative block max-w-xl"><Search className="absolute left-3 top-2.5 text-gray-400" size={16}/><input aria-label="Search routes" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search driver or route" className="w-full rounded-lg border py-2 pl-9 pr-3 dark:border-slate-700 dark:bg-slate-950"/></label></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-slate-800"><tr><th className="p-3">Driver</th><th className="p-3">Period</th><th className="p-3 text-right">Packages</th><th className="p-3 text-right">Overall</th><th className="p-3 text-right">POD</th><th className="p-3 text-right">CDF</th><th className="p-3 text-right">DSB</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{rows.map((r,i)=><tr key={`${r.driver_id}-${i}`}><td className="p-3 font-medium dark:text-white">{r.driver_name||r.driver_id||'Unknown'}</td><td className="p-3 text-xs text-gray-500">{r.date}</td><td className="p-3 text-right tabular-nums">{r.packages?.toLocaleString()||'—'}</td><td className="p-3 text-right font-semibold">{r.overall_score==null?'—':`${Number(r.overall_score).toFixed(1)}%`}</td><td className="p-3 text-right">{r.pod==null?'—':`${Number(r.pod).toFixed(1)}%`}</td><td className="p-3 text-right">{r.cdf??'—'}</td><td className="p-3 text-right">{r.dsb??'—'}</td></tr>)}</tbody></table></div><p className="border-t p-3 text-xs text-gray-500 dark:border-slate-800">Showing {rows.length} records from {data?.source}</p></section>
  </div>;
};
export default RoutesPage;
