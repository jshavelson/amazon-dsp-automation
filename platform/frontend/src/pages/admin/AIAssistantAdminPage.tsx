import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { usePlatformContext } from '@/hooks/usePlatformContext';

type AIConfig = {
  configured: boolean;
  provider: string;
  model: string;
  organizationConfigured: boolean;
  projectConfigured: boolean;
  storage: string;
  writeOnly: boolean;
  lastFour: string | null;
};

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

const AIAssistantAdminPage: React.FC = () => {
  const { data: context } = usePlatformContext();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [organization, setOrganization] = useState('');
  const [project, setProject] = useState('');
  const [notice, setNotice] = useState('');
  const { data, isLoading, error } = useQuery<AIConfig>({
    queryKey: ['assistant-config'],
    queryFn: () => api.get('/assistant/config'),
    enabled: context?.user.isPlatformAdmin === true,
  });

  useEffect(() => { if (data?.model) setModel(data.model); }, [data?.model]);

  const save = useMutation({
    mutationFn: () => api.put<AIConfig>('/assistant/config', { apiKey, model, organization, project }),
    onSuccess: async () => {
      setApiKey('');
      setNotice('Credentials saved securely. Run the connection test before relying on the assistant.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-config'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-status'] }),
      ]);
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ status: string; checkedAt: string }>('/assistant/config/test'),
    onSuccess: (result) => setNotice(`OpenAI connection verified at ${new Date(result.checkedAt).toLocaleString()}.`),
  });

  if (!context?.user.isPlatformAdmin) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Super administrator access required.</div>;
  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading AI configuration…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">AI configuration could not be loaded.</div>;

  return <div className="mx-auto max-w-3xl space-y-6">
    <header>
      <div className="flex items-center gap-3"><Bot className="text-blue-600"/><h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Assistant Setup</h1></div>
      <p className="mt-1 text-sm text-gray-500">Configure the tenant’s OpenAI API credentials. Credential values are write-only and are never returned to the browser.</p>
    </header>

    <section className="rounded-xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold text-gray-900 dark:text-white">OpenAI connection</h2><p className="text-sm text-gray-500">Model: {data?.model || model}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${data?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{data?.configured ? `Configured ••••${data.lastFour || ''}` : 'Not configured'}</span>
      </div>
      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <ShieldCheck className="mr-2 inline h-4 w-4"/>Stored in {data?.storage || 'managed secret storage'}. Saving a new key rotates the application credential.
      </div>
    </section>

    <section className="rounded-xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><KeyRound className="h-4 w-4"/>Credential details</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2 text-sm font-medium text-gray-700 dark:text-slate-200">OpenAI API key<input type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={data?.configured ? 'Enter a new key to rotate the credential' : 'sk-…'} className={fieldClass}/></label>
        <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Model<input value={model} onChange={e => setModel(e.target.value)} className={fieldClass}/></label>
        <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Organization ID <span className="font-normal text-gray-400">(optional)</span><input value={organization} onChange={e => setOrganization(e.target.value)} placeholder={data?.organizationConfigured ? 'Configured — enter to replace' : 'org_…'} className={fieldClass}/></label>
        <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Project ID <span className="font-normal text-gray-400">(optional)</span><input value={project} onChange={e => setProject(e.target.value)} placeholder={data?.projectConfigured ? 'Configured — enter to replace' : 'proj_…'} className={fieldClass}/></label>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button disabled={apiKey.trim().length < 20 || save.isPending} onClick={() => { setNotice(''); save.mutate(); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{save.isPending ? 'Saving…' : data?.configured ? 'Rotate credentials' : 'Save credentials'}</button>
        <button disabled={!data?.configured || test.isPending} onClick={() => { setNotice(''); test.mutate(); }} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">{test.isPending ? 'Testing…' : 'Test connection'}</button>
      </div>
      {(save.error || test.error) && <p className="mt-3 text-sm text-red-600">{String((save.error || test.error) instanceof Error ? (save.error || test.error)?.message : 'Request failed')}</p>}
      {notice && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4"/>{notice}</p>}
    </section>
  </div>;
};

export default AIAssistantAdminPage;
