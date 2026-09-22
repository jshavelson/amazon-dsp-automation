import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/services/api';
import { MetricCard, OperationalSourceBanner } from '@/components/shared/OperationalSourceBanner';

type Dispute = { week:string; driver_id:string; driver_name:string; metric:string; reason:string; status:string; priority:number; tba_ids:string; evidence_sources:string; appeal_details:string; submitted_at:string|null; outcome:string|null };
const parseCount=(value:string)=>{try{return JSON.parse(value||'[]').length}catch{return 0}};

const DisputesPage: React.FC = () => {
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('all');
  const {data=[],isLoading,error,refetch}=useQuery<Dispute[]>({queryKey:['operational-disputes'],queryFn:()=>api.get<Dispute[]>('/disputes')});
  const statuses=useMemo(()=>[...new Set(data.map(d=>d.status))].sort(),[data]);
  const rows=useMemo(()=>data.filter(d=>(status==='all'||d.status===status)&&`${d.driver_name} ${d.metric} ${d.reason} ${d.week}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(a.priority||99)-(b.priority||99)),[data,search,status]);
  const ready=data.filter(d=>d.status==='ready_for_review').length;
  const blocked=data.filter(d=>d.status==='needs_additional_validation').length;
  const tbas=data.reduce((n,d)=>n+parseCount(d.tba_ids),0);
  if(isLoading)return <div className="rounded-xl border bg-white p-8">Loading disputes…</div>;
  if(error)return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Disputes could not be loaded. <button className="underline" onClick={()=>refetch()}>Retry</button></div>;
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold dark:text-white">Dispute Center</h1><p className="text-sm text-gray-500">Review-ranked Amazon disputes with exact evidence and submission wording.</p></header>
    <OperationalSourceBanner source="Amazon Logistics + weekly scorecard evidence" detail="Cases shown here are review records only. Amazon submission remains blocked until owner approval and a healthy Amazon session." />
    <div className="grid gap-4 sm:grid-cols-4"><MetricCard label="Total cases" value={data.length}/><MetricCard label="Ready for review" value={ready}/><MetricCard label="Need validation" value={blocked}/><MetricCard label="TBA IDs" value={tbas}/></div>
    {data.length===0?<section className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900"><h2 className="text-xl font-semibold text-gray-900 dark:text-white">No disputes for this tenant</h2><p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Disputes will appear after this tenant’s Amazon scorecard and supporting evidence sources are connected.</p></section>:<section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap gap-3 border-b p-4 dark:border-slate-800"><label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 text-gray-400" size={16}/><input aria-label="Search disputes" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search driver, week, metric or reason" className="w-full rounded-lg border py-2 pl-9 pr-3 dark:border-slate-700 dark:bg-slate-950"/></label><select aria-label="Dispute status" value={status} onChange={e=>setStatus(e.target.value)} className="rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"><option value="all">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-slate-800"><tr><th className="p-3">Priority</th><th className="p-3">Week / driver</th><th className="p-3">Metric</th><th className="p-3">Reason</th><th className="p-3">TBAs</th><th className="p-3">Evidence</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{rows.map((d,i)=><tr key={`${d.week}-${d.driver_id}-${i}`}><td className="p-3 font-bold text-blue-700">#{d.priority||'—'}</td><td className="p-3"><strong className="block dark:text-white">{d.week}</strong><span className="text-xs text-gray-500">{d.driver_name}</span></td><td className="p-3 font-medium dark:text-slate-200">{d.metric}</td><td className="p-3 max-w-xs text-xs text-gray-600 dark:text-slate-300">{d.reason}</td><td className="p-3 text-center">{parseCount(d.tba_ids)}</td><td className="p-3 text-center">{parseCount(d.evidence_sources)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${d.status==='ready_for_review'?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}`}>{d.status.replaceAll('_',' ')}</span></td></tr>)}</tbody></table></div><p className="border-t p-3 text-xs text-gray-500 dark:border-slate-800">Showing {rows.length} of {data.length} cases. No dispute is submitted from this list without explicit approval.</p></section>}
  </div>;
};
export default DisputesPage;
