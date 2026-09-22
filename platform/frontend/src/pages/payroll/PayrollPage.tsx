import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { MetricCard, OperationalSourceBanner } from '@/components/shared/OperationalSourceBanner';

type Timecard={id:number;date:string;driver_id:string;duration_hours:number;pay_code:string};
type Route={id:number;driver_id:string;date:string;packages:number;status:string};
type Summary={period?:{startDate:string;endDate:string};workerCount?:number;employeesWithTime?:number;workedDayEntries?:number;totalHours?:number;payrollOutputStatus?:string};
type Payload={timecards:Timecard[];routes:Route[];summary:Summary;source:string;sourceStatus:string};
type Discrepancy={driver_id:string;driver_name:string;date:string;adp_hours:number;stops:number;packages:number};

const PayrollPage:React.FC=()=>{
  const {data,isLoading,error,refetch}=useQuery<Payload>({queryKey:['payroll-reconciliation'],queryFn:()=>api.get<Payload>('/payroll')});
  const {data:discrepancies=[]}=useQuery<Discrepancy[]>({queryKey:['payroll-discrepancies'],queryFn:()=>api.get<Discrepancy[]>('/payroll/discrepancies')});
  if(isLoading)return <div className="rounded-xl border bg-white p-8">Loading payroll…</div>;
  if(error||!data)return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Payroll could not be loaded. <button className="underline" onClick={()=>refetch()}>Retry</button></div>;
  const s=data.summary||{}; const period=s.period?`${s.period.startDate} – ${s.period.endDate}`:'latest available';
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold dark:text-white">Payroll</h1><p className="text-sm text-gray-500">ADP timecard and Amazon work-assignment reconciliation for {period}.</p></header>
    <OperationalSourceBanner source={data.source||'ADP Workforce Now'} detail={`${data.sourceStatus}. Connect ADP to refresh timecards automatically; payroll-register output still requires the correct ADP CAR scope or an approved register upload.`}/>
    <div className="grid gap-4 sm:grid-cols-4"><MetricCard label="Employees with time" value={s.employeesWithTime??'—'} detail={`${s.workerCount??'—'} workers in source`}/><MetricCard label="Worked-day entries" value={s.workedDayEntries??data.timecards.length}/><MetricCard label="Total hours" value={s.totalHours==null?'—':s.totalHours.toFixed(1)}/><MetricCard label="Exceptions" value={discrepancies.length}/></div>
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="border-b p-4 dark:border-slate-800"><h2 className="font-semibold dark:text-white">Daily timecard totals</h2><p className="text-xs text-gray-500">Current locally ingested ADP records.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-slate-800"><tr><th className="p-3">Date</th><th className="p-3">Employee/source key</th><th className="p-3 text-right">Hours</th><th className="p-3">Pay code</th></tr></thead><tbody className="divide-y dark:divide-slate-800">{data.timecards.map(t=><tr key={t.id}><td className="p-3 font-medium dark:text-white">{t.date}</td><td className="p-3 text-xs text-gray-500">{t.driver_id||'Aggregate daily import'}</td><td className="p-3 text-right font-semibold tabular-nums">{Number(t.duration_hours).toFixed(2)}</td><td className="p-3 text-xs">{t.pay_code||'—'}</td></tr>)}</tbody></table></div></section>
    <section className="rounded-xl border bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold dark:text-white">Reconciliation status</h2>{discrepancies.length?<ul className="mt-3 space-y-2">{discrepancies.map((d,i)=><li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{d.driver_name} · {d.date}: {d.adp_hours} ADP hours with Amazon route activity</li>)}</ul>:<p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">No zero-hour/route-work discrepancies were detected in the imported records.</p>}</section>
  </div>;
};
export default PayrollPage;
