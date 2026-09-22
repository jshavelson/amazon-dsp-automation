import React, { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { api } from '@/services/api';
import { usePlatformContext, PlatformFeature } from '@/hooks/usePlatformContext';

type Member = { identitySubject: string; email: string; givenName?: string; familyName?: string; role: string; status: string; createdAt: string };
type InvitationResult = { member: Member; invitationSent: boolean };

const apiError = (error: unknown) => {
  const responseError = error as { response?: { data?: { error?: string } }; message?: string };
  return responseError.response?.data?.error || responseError.message || 'The user could not be added.';
};

export const isValidInvitation = ({ givenName, familyName, email, role, roles }: { givenName: string; familyName: string; email: string; role: string; roles: string[] }) => Boolean(
  givenName.trim() && familyName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && roles.includes(role)
);

export const UsersRolesPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: context } = usePlatformContext();
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [notice, setNotice] = useState<{ kind: 'success'|'error'; message: string }|null>(null);
  const { data, isLoading, error: membersError } = useQuery<{ members: Member[]; roles: string[] }>({ queryKey: ['members'], queryFn: () => api.get('/members') });
  const assignableRoles = useMemo(() => (data?.roles || []).filter(item => item !== 'owner' || context?.user.isPlatformAdmin), [data?.roles, context?.user.isPlatformAdmin]);
  const invite = useMutation({
    mutationFn: () => api.post<InvitationResult>('/members/invitations', { email: email.trim().toLowerCase(), givenName: givenName.trim(), familyName: familyName.trim(), role }),
    onMutate: () => setNotice(null),
    onSuccess: async (result) => {
      setGivenName(''); setFamilyName(''); setEmail('');
      setNotice({ kind: 'success', message: result.invitationSent ? `Invitation emailed to ${result.member.email}.` : `${result.member.email} is authorized and can sign in through the normal identity flow.` });
      await qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: error => setNotice({ kind: 'error', message: apiError(error) }),
  });
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
  const submit = (event: FormEvent) => { event.preventDefault(); if (!invite.isPending) invite.mutate(); };
  const canSubmit = isValidInvitation({ givenName, familyName, email, role, roles: assignableRoles });
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users & Roles</h1><p className="text-sm text-gray-500">Invite users by verified email and assign the minimum role they need. Access remains tenant-scoped.</p></header>
    <section className="rounded-xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><UserPlus size={20} className="text-blue-600"/><h2 className="font-semibold dark:text-white">Add user</h2></div><form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.5fr_1fr_auto]" onSubmit={submit}><label className="text-sm font-medium dark:text-slate-200">First name<input required autoComplete="given-name" aria-label="First name" value={givenName} onChange={e => setGivenName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950 dark:text-white"/></label><label className="text-sm font-medium dark:text-slate-200">Last name<input required autoComplete="family-name" aria-label="Last name" value={familyName} onChange={e => setFamilyName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950 dark:text-white"/></label><label className="text-sm font-medium dark:text-slate-200">Email<input required type="email" autoComplete="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" className="mt-1 w-full rounded-lg border px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950 dark:text-white"/></label><label className="text-sm font-medium dark:text-slate-200">Role<select aria-label="Role" value={role} onChange={e => setRole(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal capitalize dark:border-slate-700 dark:bg-slate-950 dark:text-white">{assignableRoles.map(item => <option key={item} value={item}>{item}</option>)}</select></label><button type="submit" disabled={!canSubmit || invite.isPending} className="self-end rounded-lg bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">{invite.isPending ? 'Adding…' : 'Add user'}</button></form><p className="mt-3 text-xs text-gray-500">Production sends a secure Cognito invitation email with a temporary password. The user completes MFA setup at first sign-in.</p>{notice&&<div role="status" className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${notice.kind==='success'?'border-emerald-200 bg-emerald-50 text-emerald-900':'border-red-200 bg-red-50 text-red-900'}`}>{notice.kind==='success'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}<span>{notice.message}</span></div>}</section>
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-800 dark:bg-slate-900">{isLoading?<div className="p-6 text-sm text-gray-500">Loading users…</div>:membersError?<div className="p-6 text-sm text-red-700">Users could not be loaded.</div>:<table className="w-full text-sm"><thead className="bg-gray-50 dark:bg-slate-800"><tr><th className="p-3 text-left">User</th><th className="p-3 text-left">Role</th><th className="p-3 text-left">Status</th><th className="p-3">Action</th></tr></thead><tbody>{(data?.members || []).map(m => <MemberRow key={m.identitySubject} member={m} roles={m.role==='owner'&&!assignableRoles.includes('owner')?['owner',...assignableRoles]:assignableRoles} disabled={!context?.user.isPlatformAdmin&&(m.role==='owner'||m.identitySubject===context?.user.id)} save={v => update.mutate(v)} impersonate={context?.user.isPlatformAdmin && m.status === 'active' ? () => impersonate.mutate(m) : undefined}/>)}</tbody></table>}</section></div>;
};

const MemberRow = ({ member, roles, disabled, save, impersonate }: { member: Member; roles: string[]; disabled: boolean; save: (m: Member) => void; impersonate?: () => void }) => {
  const [draft, setDraft] = useState(member);
  return <tr className="border-t dark:border-slate-800"><td className="p-3 dark:text-white">{member.email}<span className="block text-xs text-gray-400">{member.identitySubject}</span></td><td className="p-3"><select disabled={disabled} value={draft.role} onChange={e => setDraft({...draft, role:e.target.value})} className="rounded border disabled:opacity-60 dark:bg-slate-950 dark:text-white">{roles.map(r => <option key={r}>{r}</option>)}</select></td><td className="p-3"><select disabled={disabled} value={draft.status} onChange={e => setDraft({...draft, status:e.target.value})} className="rounded border disabled:opacity-60 dark:bg-slate-950 dark:text-white">{['invited','active','disabled'].map(s => <option key={s}>{s}</option>)}</select></td><td className="p-3 text-center"><div className="flex justify-center gap-2"><button disabled={disabled} onClick={() => save(draft)} className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40">Save</button>{impersonate && <button onClick={impersonate} className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-amber-800">View as user</button>}</div></td></tr>;
};

export const FeatureAdminPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: context } = usePlatformContext();
  const { data } = useQuery<{ features: PlatformFeature[]; canManage: boolean }>({ queryKey: ['features-admin'], queryFn: () => api.get('/features') });
  const toggle = useMutation({ mutationFn: (f: PlatformFeature) => api.put(`/features/${f.id}`, { enabled: !f.enabled }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['features-admin'] }); qc.invalidateQueries({ queryKey: ['platform-context'] }); } });
  if (!context?.user.isPlatformAdmin) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Platform administrator access required.</div>;
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold dark:text-white">Feature Management</h1><p className="text-sm text-gray-500">Platform administrators see the complete roadmap. Disabling an implemented feature removes it from tenant navigation and blocks tenant access.</p></header><div className="grid gap-3 lg:grid-cols-2">{(data?.features || []).map(f => <article key={f.id} className="rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold dark:text-white">{f.displayName}</h2><p className="text-xs text-gray-500">{f.route} · {f.status}</p></div><button role="switch" aria-checked={f.enabled} onClick={() => toggle.mutate(f)} className={`rounded-full px-3 py-1 text-xs font-semibold ${f.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>{f.enabled ? 'Enabled' : 'Disabled'}</button></div></article>)}</div></div>;
};
