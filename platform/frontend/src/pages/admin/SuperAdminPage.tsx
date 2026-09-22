import React, { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, CircleAlert, Database, Eye, Mail, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api } from '@/services/api';
import { usePlatformContext } from '@/hooks/usePlatformContext';

type Tenant = { id: string; slug: string; displayName: string; status: 'active'|'suspended'|'closed'; createdAt: string };
type Module = { id: string; displayName: string; status: string };
type Member = { tenantSlug: string; tenantName: string; identitySubject: string; email: string; givenName?: string; familyName?: string; role: string; status: string };
type Feature = { id: string; displayName: string; route: string; enabled: boolean; overridden: boolean };
type Connection = { id: string; integrationType: string; displayName: string; authKind: string; status: string; secretReference: string; lastSuccessAt?: string|null };

const messageFor = (error: unknown) => {
  const value = error as { response?: { data?: { error?: string } }; message?: string };
  return value.response?.data?.error || value.message || 'The operation could not be completed.';
};

export const validTenantDraft = (draft: Record<string, string>) => Boolean(
  /^[a-z][a-z0-9-]{2,62}$/.test(draft.slug || '') &&
  draft.displayName?.trim() && draft.ownerGivenName?.trim() && draft.ownerFamilyName?.trim() &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.ownerEmail || '')
);

const emptyDraft = { slug: '', displayName: '', ownerEmail: '', ownerGivenName: '', ownerFamilyName: '' };
const emptyMemberDraft = { givenName: '', familyName: '', email: '', role: 'viewer' };
export const validMemberDraft = (draft: typeof emptyMemberDraft) => Boolean(
  draft.givenName.trim() && draft.familyName.trim() &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) &&
  ['owner', 'admin', 'reviewer', 'analyst', 'viewer'].includes(draft.role)
);

const SuperAdminPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: context } = usePlatformContext();
  const [selectedSlug, setSelectedSlug] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [memberDraft, setMemberDraft] = useState(emptyMemberDraft);
  const [selectedModules, setSelectedModules] = useState<string[]>(['executive_dashboard', 'data_integrations']);
  const [notice, setNotice] = useState<{ kind: 'success'|'error'; text: string }|null>(null);
  const tenantQuery = useQuery<{ tenants: Tenant[]; modules: Module[] }>({
    queryKey: ['super-admin-tenants'], queryFn: () => api.get('/super-admin/tenants'), enabled: context?.user.isPlatformAdmin === true
  });
  const tenants = tenantQuery.data?.tenants || [];
  const activeSlug = selectedSlug || tenants[0]?.slug || '';
  const selectedTenant = tenants.find((item) => item.slug === activeSlug);
  const features = useQuery<{ features: Feature[] }>({
    queryKey: ['super-admin-features', activeSlug],
    queryFn: () => api.get(`/super-admin/tenants/${activeSlug}/features`), enabled: Boolean(activeSlug)
  });
  const connections = useQuery<{ connections: Connection[] }>({
    queryKey: ['super-admin-connections', activeSlug],
    queryFn: () => api.get(`/super-admin/tenants/${activeSlug}/connections`), enabled: Boolean(activeSlug)
  });
  const members = useQuery<{ members: Member[]; total: number }>({
    queryKey: ['super-admin-members', activeSlug],
    queryFn: () => api.get('/super-admin/members', { tenantSlug: activeSlug }), enabled: Boolean(activeSlug)
  });
  const createTenant = useMutation({
    mutationFn: () => api.post('/super-admin/tenants', { ...draft, ownerEmail: draft.ownerEmail.trim().toLowerCase(), moduleIds: selectedModules }),
    onSuccess: async () => {
      setNotice({ kind: 'success', text: `${draft.displayName} was provisioned and its owner was invited.` });
      setSelectedSlug(draft.slug); setDraft(emptyDraft);
      await qc.invalidateQueries({ queryKey: ['super-admin-tenants'] });
    },
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const updateStatus = useMutation({
    mutationFn: (status: Tenant['status']) => api.put(`/super-admin/tenants/${activeSlug}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-tenants'] }),
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const toggleFeature = useMutation({
    mutationFn: (feature: Feature) => api.put(`/super-admin/tenants/${activeSlug}/features/${feature.id}`, { enabled: !feature.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-features', activeSlug] }),
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const impersonate = useMutation({
    mutationFn: async (member: Member) => {
      const reason = window.prompt(`Reason for viewing ${member.tenantName} as ${member.email}:`);
      if (!reason) throw new Error('Support session cancelled.');
      return api.post<{ token: string }>('/super-admin/impersonate', { tenantSlug: member.tenantSlug, targetSubject: member.identitySubject, reason, durationMinutes: 15 });
    },
    onSuccess: (result, member) => {
      sessionStorage.setItem('dsp-support-previous-tenant', sessionStorage.getItem('dsp-active-tenant') || 'jecs');
      sessionStorage.setItem('dsp-active-tenant', member.tenantSlug);
      sessionStorage.setItem('dsp-support-session', result.token);
      qc.clear();
      window.location.href = import.meta.env.PROD ? '/app/dashboard' : '/dashboard';
    },
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const resendInvitation = useMutation({
    mutationFn: (member: Member) => api.post<{ member: Member; invitationSent: boolean }>(
      `/members/${encodeURIComponent(member.identitySubject)}/resend-invitation`,
      undefined,
      { headers: { 'x-tenant-id': member.tenantSlug } }
    ),
    onSuccess: (result) => setNotice({ kind: 'success', text: result.invitationSent ? `Invitation email resent to ${result.member.email}.` : `Invitation resend validated for ${result.member.email}; local development does not send email.` }),
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const addMember = useMutation({
    mutationFn: () => api.post<{ member: Member; invitationSent: boolean }>('/members/invitations', {
      ...memberDraft, email: memberDraft.email.trim().toLowerCase(),
    }, { headers: { 'x-tenant-id': activeSlug } }),
    onSuccess: async (result) => {
      setMemberDraft(emptyMemberDraft);
      setNotice({ kind: 'success', text: result.invitationSent ? `Invitation emailed to ${result.member.email}.` : `${result.member.email} was added to ${selectedTenant?.displayName}; local development does not send email.` });
      await qc.invalidateQueries({ queryKey: ['super-admin-members', activeSlug] });
    },
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const updateMember = useMutation({
    mutationFn: (member: Member) => api.put<{ member: Member }>(
      `/members/${encodeURIComponent(member.identitySubject)}`,
      { role: member.role, status: member.status },
      { headers: { 'x-tenant-id': member.tenantSlug } }
    ),
    onSuccess: async () => {
      setNotice({ kind: 'success', text: 'Tenant member updated.' });
      await qc.invalidateQueries({ queryKey: ['super-admin-members', activeSlug] });
    },
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const openLocalTenant = () => {
    sessionStorage.removeItem('dsp-support-session');
    sessionStorage.removeItem('dsp-support-previous-tenant');
    sessionStorage.setItem('dsp-active-tenant', activeSlug);
    qc.clear();
    window.location.href = '/dashboard';
  };
  const downloadChecklist = useMutation({
    mutationFn: () => api.get<Blob>('/super-admin/onboarding-checklist.pdf', undefined, { responseType: 'blob' }),
    onSuccess: (document) => {
      const url = URL.createObjectURL(document);
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = 'tenant-onboarding-checklist.pdf'; anchor.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => setNotice({ kind: 'error', text: messageFor(error) })
  });
  const canCreate = validTenantDraft(draft);
  const moduleIds = useMemo(() => new Set(selectedModules), [selectedModules]);

  if (!context?.user.isPlatformAdmin) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Platform administrator access required.</div>;
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold dark:text-white">Tenant Administration</h1><p className="text-sm text-gray-500">Provision customers, control tenant features, review connection metadata, and open audited read-only support sessions.</p></header>
    {notice && <div role="status" className={`flex gap-2 rounded-xl border p-3 text-sm ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{notice.kind === 'success' ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>}<span>{notice.text}</span></div>}
    <section className="rounded-xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><Plus size={19} className="text-blue-600"/><h2 className="font-semibold dark:text-white">Provision tenant</h2></div>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (canCreate) createTenant.mutate(); }} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {([['displayName','Company name'],['slug','Tenant slug'],['ownerGivenName','Owner first name'],['ownerFamilyName','Owner last name'],['ownerEmail','Owner email']] as const).map(([key,label]) => <label key={key} className="text-sm font-medium dark:text-slate-200">{label}<input required type={key === 'ownerEmail' ? 'email' : 'text'} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: key === 'slug' ? event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') : event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950"/></label>)}
        <fieldset className="md:col-span-2 xl:col-span-4"><legend className="text-sm font-medium dark:text-slate-200">Trial modules</legend><div className="mt-2 flex flex-wrap gap-2">{(tenantQuery.data?.modules || []).map((module) => <label key={module.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs dark:border-slate-700"><input type="checkbox" checked={moduleIds.has(module.id)} onChange={() => setSelectedModules(moduleIds.has(module.id) ? selectedModules.filter((id) => id !== module.id) : [...selectedModules, module.id])}/>{module.displayName}</label>)}</div></fieldset>
        <button disabled={!canCreate || createTenant.isPending} className="self-end rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{createTenant.isPending ? 'Provisioning…' : 'Create tenant'}</button>
      </form><p className="mt-3 text-xs text-gray-500">Credentials are never collected here. Connections are created as metadata and completed through each tenant’s secure vault or reconnect flow.</p>
    </section>
    <section className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b p-4 dark:border-slate-800"><h2 className="flex items-center gap-2 font-semibold dark:text-white"><Building2 size={18}/>Tenants</h2></div>{tenantQuery.isLoading?<p className="p-4 text-sm text-gray-500">Loading tenants…</p>:<div className="divide-y dark:divide-slate-800">{tenants.map((tenant) => <button key={tenant.slug} onClick={() => setSelectedSlug(tenant.slug)} className={`block w-full p-4 text-left ${activeSlug === tenant.slug ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}><span className="font-medium dark:text-white">{tenant.displayName}</span><span className="mt-1 flex justify-between text-xs text-gray-500"><span>{tenant.slug}</span><span className="capitalize">{tenant.status}</span></span></button>)}</div>}</div>
      <div className="space-y-5">{selectedTenant ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><h2 className="font-semibold dark:text-white">{selectedTenant.displayName}</h2><p className="text-xs text-gray-500">{selectedTenant.slug} · created {new Date(selectedTenant.createdAt).toLocaleDateString()}</p></div><div className="flex items-center gap-2">{import.meta.env.DEV && <button onClick={openLocalTenant} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900">Open tenant locally</button>}<select aria-label="Tenant status" value={selectedTenant.status} onChange={(event) => updateStatus.mutate(event.target.value as Tenant['status'])} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select></div></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel icon={<ShieldCheck size={18}/>} title="Features"><div className="space-y-2">{(features.data?.features || []).map((feature) => <div key={feature.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm dark:border-slate-700"><div><p className="font-medium dark:text-white">{feature.displayName}</p><p className="text-xs text-gray-500">{feature.route}</p></div><button role="switch" aria-checked={feature.enabled} onClick={() => toggleFeature.mutate(feature)} className={`rounded-full px-3 py-1 text-xs font-semibold ${feature.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>{feature.enabled ? 'Enabled' : 'Disabled'}</button></div>)}</div></Panel>
          <Panel icon={<Users size={18}/>} title={`Members (${members.data?.total || 0})`}>
            <form className="mb-4 grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (validMemberDraft(memberDraft)) addMember.mutate(); }}>
              <input aria-label="Member first name" placeholder="First name" value={memberDraft.givenName} onChange={(event) => setMemberDraft({...memberDraft, givenName: event.target.value})} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"/>
              <input aria-label="Member last name" placeholder="Last name" value={memberDraft.familyName} onChange={(event) => setMemberDraft({...memberDraft, familyName: event.target.value})} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"/>
              <input aria-label="Member email" type="email" placeholder="user@company.com" value={memberDraft.email} onChange={(event) => setMemberDraft({...memberDraft, email: event.target.value})} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"/>
              <div className="flex gap-2"><select aria-label="Member role" value={memberDraft.role} onChange={(event) => setMemberDraft({...memberDraft, role: event.target.value})} className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm capitalize dark:border-slate-700 dark:bg-slate-950">{['owner','admin','reviewer','analyst','viewer'].map((role) => <option key={role}>{role}</option>)}</select><button disabled={!validMemberDraft(memberDraft) || addMember.isPending} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"><UserPlus size={15}/>{addMember.isPending ? 'Adding…' : 'Add'}</button></div>
            </form>
            <div className="space-y-2">{(members.data?.members || []).map((member) => <TenantMemberRow key={member.identitySubject} member={member} save={(value) => updateMember.mutate(value)} resend={member.status === 'invited' ? () => resendInvitation.mutate(member) : undefined} resending={resendInvitation.isPending && resendInvitation.variables?.identitySubject === member.identitySubject} view={member.status === 'active' ? () => impersonate.mutate(member) : undefined}/>)}</div>
          </Panel>
          <Panel icon={<Database size={18}/>} title="Connection metadata"><div className="space-y-2">{(connections.data?.connections || []).length ? connections.data?.connections.map((connection) => <div key={connection.id} className="rounded-lg border p-3 text-sm dark:border-slate-700"><div className="flex justify-between"><strong className="dark:text-white">{connection.displayName}</strong><span className="capitalize text-gray-500">{connection.status.replace('_',' ')}</span></div><p className="mt-1 text-xs text-gray-500">{connection.integrationType} · {connection.authKind.replace('_',' ')}</p><p className="mt-1 truncate text-[11px] text-gray-400">{connection.secretReference}</p></div>) : <p className="text-sm text-gray-500">No connections configured. Add them through the tenant Connections screen so credentials stay write-only.</p>}</div></Panel>
          <Panel icon={<CheckCircle2 size={18}/>} title="Onboarding"><p className="text-sm text-gray-600 dark:text-slate-300">Use the tenant onboarding checklist for company, station, fleet, driver, connection, feature, and approval information.</p><button onClick={() => downloadChecklist.mutate()} className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">{downloadChecklist.isPending ? 'Preparing…' : 'Download checklist'}</button></Panel>
        </div>
      </> : <div className="rounded-xl border bg-white p-8 text-center text-gray-500 dark:border-slate-800 dark:bg-slate-900">Create or select a tenant.</div>}</div>
    </section>
  </div>;
};

const TenantMemberRow = ({ member, save, resend, resending, view }: {
  member: Member; save: (member: Member) => void; resend?: () => void; resending: boolean; view?: () => void;
}) => {
  const [draft, setDraft] = useState(member);
  return <div className="rounded-lg border p-3 text-sm dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium dark:text-white">{member.email}</p><p className="text-xs text-gray-500">{[member.givenName, member.familyName].filter(Boolean).join(' ') || member.identitySubject}</p></div><div className="flex flex-wrap gap-2"><select aria-label={`Role for ${member.email}`} value={draft.role} onChange={(event) => setDraft({...draft, role: event.target.value})} className="rounded border px-2 py-1 text-xs capitalize dark:border-slate-700 dark:bg-slate-950">{['owner','admin','reviewer','analyst','viewer'].map((role) => <option key={role}>{role}</option>)}</select><select aria-label={`Status for ${member.email}`} value={draft.status} onChange={(event) => setDraft({...draft, status: event.target.value})} className="rounded border px-2 py-1 text-xs capitalize dark:border-slate-700 dark:bg-slate-950">{['invited','active','disabled'].map((status) => <option key={status}>{status}</option>)}</select><button onClick={() => save(draft)} className="rounded bg-slate-800 px-2 py-1 text-xs text-white">Save</button></div></div><div className="mt-2 flex flex-wrap justify-end gap-2">{resend && <button disabled={resending} onClick={resend} className="flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-900 disabled:opacity-50"><Mail size={14}/>{resending ? 'Sending…' : 'Resend invite'}</button>}{view && <button onClick={view} className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900"><Eye size={14}/>View as user</button>}</div></div>;
};

const Panel = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => <section className="rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h3 className="mb-3 flex items-center gap-2 font-semibold dark:text-white">{icon}{title}</h3>{children}</section>;

export default SuperAdminPage;
