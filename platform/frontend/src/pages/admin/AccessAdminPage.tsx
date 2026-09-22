import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { usePlatformContext, PlatformFeature } from '@/hooks/usePlatformContext';

type Member = { identitySubject: string; email: string; role: string; status: string; createdAt: string };

export const UsersRolesPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: context } = usePlatformContext();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const { data } = useQuery<{ members: Member[]; roles: string[] }>({ queryKey: ['members'], queryFn: () => api.get('/members') });
  const invite = useMutation({ mutationFn: () => api.post('/members/invitations', { email, role }), onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['members'] }); } });
  const update = useMutation({ mutationFn: (m: Member) => api.put(`/members/${encodeURIComponent(m.identitySubject)}`, { role: m.role, status: m.status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }) });
  const impersonate = useMutation({
    mutationFn: async (member: Member) => {
      const reason = window.prompt(`Troubleshooting reason for viewing the application as ${member.email}:`);
      if (!reason) throw new Error('impersonation cancelled');
      return api.post<{ token: string }>('/support/impersonation', { targetSubject: member.identitySubject, reason, durationMinutes: 15 });
    },
    onSuccess: (result) => {
      sessionStorage.setItem('dsp-support-session', result.token);
      qc.clear();
      window.location.href = '/app/dashboard';
    }
  });
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users & Roles</h1><p className="text-sm text-gray-500">Tenant owners and admins authorize users by verified email and assign tenant roles. Pending users activate automatically after their first verified sign-in.</p></header>
    <section className="rounded-xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold dark:text-white">Authorize user</h2><div className="mt-3 flex flex-wrap gap-2"><input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" className="min-w-64 rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"/><select value={role} onChange={e => setRole(e.target.value)} className="rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white">{(data?.roles || []).filter(r => r !== 'owner').map(r => <option key={r}>{r}</option>)}</select><button disabled={!email || invite.isPending} onClick={() => invite.mutate()} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Add pending user</button></div><p className="mt-2 text-xs text-gray-500">This authorizes the email; it does not send an invitation email. The user signs in through the normal verified identity flow.</p></section>
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-sm"><thead className="bg-gray-50 dark:bg-slate-800"><tr><th className="p-3 text-left">User</th><th className="p-3 text-left">Role</th><th className="p-3 text-left">Status</th><th className="p-3">Action</th></tr></thead><tbody>{(data?.members || []).map(m => <MemberRow key={m.identitySubject} member={m} roles={data?.roles || []} save={v => update.mutate(v)} impersonate={context?.user.isPlatformAdmin && m.status === 'active' ? () => impersonate.mutate(m) : undefined}/>)}</tbody></table></section></div>;
};

const MemberRow = ({ member, roles, save, impersonate }: { member: Member; roles: string[]; save: (m: Member) => void; impersonate?: () => void }) => {
  const [draft, setDraft] = useState(member);
  return <tr className="border-t dark:border-slate-800"><td className="p-3 dark:text-white">{member.email}<span className="block text-xs text-gray-400">{member.identitySubject}</span></td><td className="p-3"><select value={draft.role} onChange={e => setDraft({...draft, role:e.target.value})} className="rounded border dark:bg-slate-950 dark:text-white">{roles.map(r => <option key={r}>{r}</option>)}</select></td><td className="p-3"><select value={draft.status} onChange={e => setDraft({...draft, status:e.target.value})} className="rounded border dark:bg-slate-950 dark:text-white">{['invited','active','disabled'].map(s => <option key={s}>{s}</option>)}</select></td><td className="p-3 text-center"><div className="flex justify-center gap-2"><button onClick={() => save(draft)} className="rounded bg-slate-800 px-3 py-1 text-white">Save</button>{impersonate && <button onClick={impersonate} className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-amber-800">View as user</button>}</div></td></tr>;
};

export const FeatureAdminPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: context } = usePlatformContext();
  const { data } = useQuery<{ features: PlatformFeature[]; canManage: boolean }>({ queryKey: ['features-admin'], queryFn: () => api.get('/features') });
  const toggle = useMutation({ mutationFn: (f: PlatformFeature) => api.put(`/features/${f.id}`, { enabled: !f.enabled }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['features-admin'] }); qc.invalidateQueries({ queryKey: ['platform-context'] }); } });
  if (!context?.user.isPlatformAdmin) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Platform administrator access required.</div>;
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold dark:text-white">Feature Management</h1><p className="text-sm text-gray-500">Platform administrators see the complete roadmap. Disabling an implemented feature removes it from tenant navigation and blocks tenant access.</p></header><div className="grid gap-3 lg:grid-cols-2">{(data?.features || []).map(f => <article key={f.id} className="rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold dark:text-white">{f.displayName}</h2><p className="text-xs text-gray-500">{f.route} · {f.status}</p></div><button role="switch" aria-checked={f.enabled} onClick={() => toggle.mutate(f)} className={`rounded-full px-3 py-1 text-xs font-semibold ${f.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>{f.enabled ? 'Enabled' : 'Disabled'}</button></div></article>)}</div></div>;
};
