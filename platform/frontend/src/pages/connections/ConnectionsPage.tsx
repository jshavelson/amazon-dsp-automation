import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudUpload, FileSpreadsheet, KeyRound, Link2, Loader2, Lock, RefreshCw, ShieldAlert, Upload, Wand2, X } from 'lucide-react';
import { api } from '@/services/api';

type AuthKind = 'browser_session' | 'api_credentials' | 'imap_password' | 'manual_upload' | 'oauth';
type Status = 'healthy' | 'needs_reauth' | 'degraded' | 'pending' | 'not_connected' | 'disabled';

const FINANCIAL_SOURCE = 'financial_charges';
const COVERAGE_CLASSES = ['Rental + lease coverage', 'Amazon LMR coverage', 'Unallocated', 'Excluded from fleet comparison'];

interface UploadRecord {
  id: string; source: string; originalFilename: string; storageKey: string; contentSha256: string;
  byteSize: number; status: string; periodKey: string | null; uploadedBy: string; uploadedAt: string;
  confirmedAt: string | null; provider?: string; rejectedReason?: string; parseSummary?: Record<string, unknown>;
}
interface Connection {
  id: string; displayName: string; authKind: AuthKind; category: string; schedule: string;
  description: string; feeds: string[]; reauthNote: string; status: Status; configured: boolean;
  acceptedProviders?: string[]; secretReference: string | null; lastSuccessAt: string | null;
  lastCheckedAt: string | null; lastError: string | null; latestUpload: UploadRecord | null;
  credentialFields?: { name: string; label: string; secret: boolean; placeholder?: string; configured: boolean }[];
  environments?: string[]; environment?: string | null; testable?: boolean;
  reconnectLabel?: string; reconnectAvailable?: boolean;
  lastAutomatedSyncAt?: string | null; nextRunAt?: string | null; lastSyncSummary?: Record<string, unknown> | null;
}
interface VendorRow { vendor: string; count: number; total: number; coverageClass: string }
interface VendorRule { match: string; vendor: string; treatment: 'INCLUDE' | 'EXCLUDE'; coverageClass: string }
interface Preview {
  ok: boolean; error?: string; detectedHeaders?: string[]; provider?: string; providerLabel?: string;
  providerConfidence?: number; providerReason?: string; groupedBySection?: boolean;
  columnMapping?: Record<string, string>; unmappedColumns?: string[]; rowsRead?: number;
  rowsSkipped?: number; subtotalRowsIgnored?: number; periods?: string[];
  summary?: { total: number; included: number; excluded: number; includedTotal: number; excludedTotal: number; unmatchedVin: number; byVendor: VendorRow[]; unmappedVendors: { vendor: string; count: number }[] };
}
interface PavePreview {
  ok: boolean; error?: string; providerLabel?: string; periodKey?: string;
  summary: { rowsRead: number; completedRows: number; incompleteRows: number; uniqueVins: number;
    currentFairOrBetter: number; currentPoor: number; currentGroundingRisk: number;
    currentNewDamage: number; earliestAt?: string | null; latestAt?: string | null };
}
interface RefreshResult {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  sources: Array<{ id: string; status: string; message: string }>;
}
interface Payload {
  tenant: string; servedAt: string;
  summary: { total: number; connectionTotal: number; connected: number; needsAttention: number; notConnected: number };
  connections: Connection[]; uploads: UploadRecord[];
  secretPolicy: { storage: string; pathTemplate: string; note: string };
}

const usd = (v?: number) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const when = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
const kb = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

const statusMeta: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
  healthy: { label: 'Connected', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', icon: <CheckCircle2 size={13} /> },
  needs_reauth: { label: 'Needs reconnect', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200', icon: <ShieldAlert size={13} /> },
  degraded: { label: 'Degraded', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', icon: <AlertTriangle size={13} /> },
  pending: { label: 'Pending setup', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200', icon: <Loader2 size={13} /> },
  not_connected: { label: 'Not connected', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', icon: <Link2 size={13} /> },
  disabled: { label: 'Disabled', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', icon: <X size={13} /> },
};
const authLabel: Record<AuthKind, string> = {
  browser_session: 'Sign-in session', api_credentials: 'API credentials',
  imap_password: 'Mailbox app password', manual_upload: 'Manual file upload', oauth: 'OAuth authorization',
};

const ConnectionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const paveFileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ upload: UploadRecord; preview: Preview } | null>(null);
  const [pavePreview, setPavePreview] = useState<{ upload: UploadRecord; preview: PavePreview } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<Record<string, { treatment: 'INCLUDE' | 'EXCLUDE'; coverageClass: string }>>({});
  const [credentialConnection, setCredentialConnection] = useState<Connection | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [credentialEnvironment, setCredentialEnvironment] = useState('production');

  const { data, isLoading, error, refetch, isFetching } = useQuery<Payload>({
    queryKey: ['connections'], queryFn: () => api.get<Payload>('/connections'), staleTime: 30000,
    refetchInterval: 5000,
  });
  const { data: vendorData } = useQuery<{ rules: VendorRule[] }>({
    queryKey: ['vendor-rules'], queryFn: () => api.get<{ rules: VendorRule[] }>('/vendor-rules'), staleTime: 60000,
  });

  const unmapped = preview?.preview.summary?.unmappedVendors || [];
  useEffect(() => {
    if (!unmapped.length) return;
    setDraftRules((current) => {
      const next = { ...current };
      unmapped.forEach((u) => { next[u.vendor] ||= { treatment: 'EXCLUDE', coverageClass: 'Excluded from fleet comparison' }; });
      return next;
    });
  }, [preview]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<{ upload: UploadRecord; preview: Preview }>('/uploads/' + FINANCIAL_SOURCE, form);
    },
    onSuccess: (result) => { setPreview(result); setNotice(null); },
    onError: (err: unknown) => {
      const response = (err as { response?: { data?: { upload?: UploadRecord; preview?: Preview } } }).response;
      if (response?.data?.preview) setPreview(response.data as { upload: UploadRecord; preview: Preview });
      else setNotice('Upload failed. Check the file and try again.');
    },
  });

  const paveUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<{ upload: UploadRecord; preview: PavePreview }>('/uploads/pave', form);
    },
    onSuccess: (result) => { setPavePreview(result); setNotice(null); },
    onError: () => setNotice('PAVE upload failed. Select the CSV export from the PAVE Fleet Dashboard.'),
  });

  const mapMutation = useMutation({
    mutationFn: async (uploadId: string) => {
      const existing = vendorData?.rules || [];
      const added: VendorRule[] = unmapped.map((u) => ({
        match: u.vendor.toLowerCase(), vendor: u.vendor,
        treatment: draftRules[u.vendor]?.treatment || 'EXCLUDE',
        coverageClass: draftRules[u.vendor]?.coverageClass || 'Excluded from fleet comparison',
      }));
      await api.post('/vendor-rules', { rules: [...existing, ...added] });
      return api.post<{ upload: UploadRecord; preview: Preview }>('/uploads/' + uploadId + '/reparse', {});
    },
    onSuccess: (result) => {
      setPreview(result);
      queryClient.invalidateQueries({ queryKey: ['vendor-rules'] });
      setNotice('Vendor mapping saved.');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.post('/uploads/' + id + '/confirm', {}),
    onSuccess: () => {
      setPreview(null);
      setNotice('Upload confirmed. Fleet Costs now uses this file.');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-costs-reconciliation'] });
    },
  });

  const confirmPaveMutation = useMutation({
    mutationFn: (id: string) => api.post('/uploads/' + id + '/confirm', {}),
    onSuccess: () => {
      const count = pavePreview?.preview.summary.uniqueVins || 0;
      setPavePreview(null);
      setNotice(`PAVE export confirmed. ${count} current vehicle assessments are now available to fleet screens.`);
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-compliance'] });
      queryClient.invalidateQueries({ queryKey: ['pave-vehicles'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post('/connections/' + id + '/test', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      let result = await api.post<RefreshResult>('/connections/refresh', {});
      while (result.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        result = await api.get<RefreshResult>('/connections/refresh');
      }
      return result;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      const healthy = result.sources.filter((source) => source.status === 'healthy').length;
      const attention = result.sources.filter((source) => ['degraded', 'needs_reauth'].includes(source.status)).length;
      setNotice(result.status === 'completed'
        ? `Data refreshed from ${healthy} active sources${attention ? `; ${attention} need attention` : ''}. All screens will use the latest available data.`
        : 'Refresh failed; existing data was retained.');
    },
    onError: () => setNotice('Refresh failed; existing data was retained.'),
  });

  const credentialMutation = useMutation({
    mutationFn: (connection: Connection) => api.put('/connections/' + connection.id + '/credentials', {
      environment: credentialEnvironment,
      credentials: credentialValues,
    }),
    onSuccess: () => {
      setCredentialConnection(null);
      setCredentialValues({});
      setNotice('Credentials stored securely. Test the connection to activate it.');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: () => setNotice('Credentials could not be stored. Verify the fields and try again.'),
  });

  const reconnectMutation = useMutation({
    mutationFn: async ({ connection, popup }: { connection: Connection; popup: Window | null }) => {
      try {
        const result = await api.post<{ authorizationUrl: string; message: string; launchMode?: string }>(`/connections/${connection.id}/reconnect`, {});
        if (result.launchMode === 'local_managed_browser') popup?.close();
        else if (popup) popup.location.replace(result.authorizationUrl);
        else window.location.assign(result.authorizationUrl);
        return result;
      } catch (error) {
        popup?.close();
        throw error;
      }
    },
    onSuccess: (result) => {
      setNotice(result.message);
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: () => setNotice('The reconnect session could not be started.'),
  });

  const startProviderSignIn = (connection: Connection) => {
    // Open during the click event so browser popup protection cannot suppress it
    // while the API creates the reconnect request.
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      popup.opener = null;
      popup.document.title = `Opening ${connection.reconnectLabel || connection.displayName} sign-in…`;
    }
    reconnectMutation.mutate({ connection, popup });
  };

  const openCredentialDialog = (connection: Connection) => {
    setCredentialConnection(connection);
    setCredentialValues({});
    setCredentialEnvironment(connection.environment || connection.environments?.[0] || 'production');
  };

  const onFile = useCallback((file?: File | null) => { if (file) uploadMutation.mutate(file); }, [uploadMutation]);

  const grouped = useMemo(() => {
    const groups: Record<string, Connection[]> = {};
    (data?.connections || []).forEach((c) => { (groups[c.category] ||= []).push(c); });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  if (isLoading) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">Loading connections…</div>;
  if (error || !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><strong>Connections could not be loaded.</strong><button onClick={() => refetch()} className="ml-3 underline">Retry</button></div>;

  const s = data.summary;
  const fileUploads = data.uploads.filter((u) => u.source === FINANCIAL_SOURCE || u.source === 'digits');
  const paveUploads = data.uploads.filter((u) => u.source === 'pave');
  const pv = preview?.preview;

  return <div className="space-y-6 pb-10">
    <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Tenant: {data.tenant}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Connections</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-slate-400">Connect the systems this workspace pulls from. Credentials are stored in managed secret storage and are never written to the database, the API, or these screens.</p>
      </div>
      <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending || isFetching} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={15} className={refreshMutation.isPending ? 'animate-spin' : ''} />{refreshMutation.isPending ? 'Refreshing data…' : 'Refresh data'}</button>
    </section>

    {notice && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice(null)} className="ml-auto"><X size={14} /></button></div>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[{ l: 'Sources connected', v: s.connected + ' of ' + s.connectionTotal, i: <Link2 size={20} /> },
        { l: 'Need attention', v: String(s.needsAttention), i: <ShieldAlert size={20} /> },
        { l: 'Not connected', v: String(s.notConnected), i: <AlertTriangle size={20} /> },
        { l: 'Credential storage', v: data.secretPolicy.storage, i: <Lock size={20} /> }].map((k) => (
        <article key={k.l} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{k.l}</p><p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{k.v}</p></div><span className="rounded-lg bg-gray-100 p-2 text-gray-600 dark:bg-slate-800 dark:text-slate-300">{k.i}</span></div></article>))}
    </section>

    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
      <div className="flex items-start gap-2"><Lock className="mt-0.5 shrink-0" size={16} /><p>{data.secretPolicy.note} References follow <code className="rounded bg-white/60 px-1 font-mono text-xs dark:bg-slate-900/60">{data.secretPolicy.pathTemplate}</code>.</p></div>
    </section>

    {grouped.map(([category, connections]) => (
      <section key={category}>
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">{category}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((c) => {
            const meta = statusMeta[c.status] || statusMeta.not_connected;
            const isUpload = c.authKind === 'manual_upload';
            return <article key={c.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold text-gray-900 dark:text-white">{c.displayName}</h3><p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{authLabel[c.authKind]} · {c.schedule}</p></div>
                <span className={'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' + meta.cls}>{meta.icon}{meta.label}</span>
              </div>
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-300">{c.description}</p>
              {c.acceptedProviders && <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Supports: {c.acceptedProviders.join(' · ')}</p>}
              <div className="mt-3 flex flex-wrap gap-1">{c.feeds.map((f) => <span key={f} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">{f}</span>)}</div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-gray-500 dark:text-slate-400">Last success</dt><dd className="font-medium text-gray-900 dark:text-white">{when(c.lastSuccessAt)}</dd></div><div><dt className="text-gray-500 dark:text-slate-400">Last checked</dt><dd className="font-medium text-gray-900 dark:text-white">{when(c.lastCheckedAt)}</dd></div></dl>
              {(c.lastAutomatedSyncAt || c.nextRunAt) && <dl className="mt-2 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-gray-500 dark:text-slate-400">Last data sync</dt><dd className="font-medium text-gray-900 dark:text-white">{when(c.lastAutomatedSyncAt)}</dd></div><div><dt className="text-gray-500 dark:text-slate-400">Next scheduled pull</dt><dd className="font-medium text-gray-900 dark:text-white">{when(c.nextRunAt)}</dd></div></dl>}
              {c.lastError && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{c.lastError}</p>}
              {c.status === 'needs_reauth' && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">{c.reauthNote}</p>}

              {isUpload ? <div className="mt-4">
                <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                     onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
                     className={'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition ' + (dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-300 dark:border-slate-700')}>
                  {uploadMutation.isPending ? <><Loader2 className="animate-spin text-blue-600" size={22} /><p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Detecting format and parsing…</p></>
                    : <><CloudUpload className="text-gray-400" size={22} /><p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Drop your accounting export here</p>
                      <button onClick={() => fileInput.current?.click()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><Upload size={13} />Choose file</button>
                      <p className="mt-1 text-[11px] text-gray-400">.xlsx or .csv · up to 25 MB · format detected automatically</p></>}
                  <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                {fileUploads.length > 0 && <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Upload history</p>
                  <ul className="mt-2 space-y-1.5">{fileUploads.slice(0, 4).map((u) => <li key={u.id} className="flex items-center justify-between rounded border border-gray-200 px-2.5 py-1.5 text-xs dark:border-slate-700"><span className="flex min-w-0 items-center gap-1.5"><FileSpreadsheet size={13} className="shrink-0 text-gray-400" /><span className="truncate text-gray-700 dark:text-slate-200">{u.originalFilename}</span>{u.provider && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{u.provider}</span>}</span><span className="flex shrink-0 items-center gap-2"><span className="text-gray-400">{kb(u.byteSize)}</span><span className={'rounded px-1.5 py-0.5 font-semibold ' + (u.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : u.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200')}>{u.status}</span></span></li>)}</ul></div>}
              </div> : <div className="mt-4 flex items-center gap-2">
                <button onClick={() => testMutation.mutate(c.id)} disabled={testMutation.isPending || !c.configured || !c.testable} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={13} className={testMutation.isPending ? 'animate-spin' : ''} />Test connection</button>
                {(c.credentialFields?.length || 0) > 0 &&
                  <button onClick={() => openCredentialDialog(c)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><KeyRound size={13} />{c.configured ? 'Replace credentials' : 'Configure'}</button>}
                {c.authKind === 'browser_session'
                    && <button
                        onClick={() => startProviderSignIn(c)}
                        disabled={reconnectMutation.isPending || !c.reconnectAvailable || (c.id === 'pave' && !c.configured)}
                        title={!c.reconnectAvailable ? `${c.reconnectLabel || c.displayName} login has not been configured yet.` : undefined}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
                      ><KeyRound size={13} />{c.reconnectAvailable
                          ? `${c.configured ? 'Reconnect' : 'Sign in to'} ${c.reconnectLabel || c.displayName}`
                          : `${c.reconnectLabel || c.displayName} setup unavailable`}</button>}
                {(c.credentialFields?.length || 0) === 0 && c.authKind !== 'browser_session' && <button disabled className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500"><KeyRound size={13} />Authorization unavailable</button>}
              </div>}
              {c.id === 'pave' && <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-xs font-semibold text-gray-800 dark:text-slate-100">Manual PAVE CSV</p><p className="text-[11px] text-gray-500 dark:text-slate-400">Upload → preview → confirm. Existing data is unchanged until confirmation.</p></div>
                  <button onClick={() => paveFileInput.current?.click()} disabled={paveUploadMutation.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{paveUploadMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}Choose PAVE CSV</button>
                  <input ref={paveFileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) paveUploadMutation.mutate(file); e.target.value = ''; }} />
                </div>
                {pavePreview && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-950 dark:bg-blue-950/40 dark:text-blue-100">
                  <p className="font-semibold">Preview: {pavePreview.preview.summary.rowsRead} rows · {pavePreview.preview.summary.uniqueVins} current VINs</p>
                  <p className="mt-1">{pavePreview.preview.summary.completedRows} completed · {pavePreview.preview.summary.incompleteRows} incomplete · {pavePreview.preview.summary.currentPoor} currently Poor · {pavePreview.preview.summary.currentGroundingRisk} grounding risk</p>
                  <button onClick={() => confirmPaveMutation.mutate(pavePreview.upload.id)} disabled={confirmPaveMutation.isPending} className="mt-2 inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"><CheckCircle2 size={13} />Confirm and apply</button>
                </div>}
                {paveUploads.length > 0 && <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">Latest upload: {paveUploads[0].originalFilename} · {paveUploads[0].status}</p>}
              </div>}
            </article>;
          })}
        </div>
      </section>
    ))}

    {credentialConnection && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-gray-200 p-5 dark:border-slate-800">
          <div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Connect {credentialConnection.displayName}</h2><p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Values are sent over HTTPS directly to managed secret storage and cannot be viewed after saving.</p></div>
          <button onClick={() => { setCredentialConnection(null); setCredentialValues({}); }} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          {(credentialConnection.environments?.length || 0) > 0 && <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">Environment
            <select value={credentialEnvironment} onChange={(event) => setCredentialEnvironment(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              {credentialConnection.environments!.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </select>
          </label>}
          {(credentialConnection.credentialFields || []).map((field) => <label key={field.name} className="block text-sm font-medium text-gray-700 dark:text-slate-200">{field.label}
            <input type={field.secret ? 'password' : 'text'} autoComplete="off" value={credentialValues[field.name] || ''} onChange={(event) => setCredentialValues((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.configured ? 'Enter replacement value' : field.placeholder} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          </label>)}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><Lock size={14} className="mr-1 inline" />Saving replaces the complete credential bundle. Existing values are never returned to this form.</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 p-4 dark:border-slate-800">
          <button onClick={() => { setCredentialConnection(null); setCredentialValues({}); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
          <button onClick={() => credentialMutation.mutate(credentialConnection)} disabled={credentialMutation.isPending || (credentialConnection.credentialFields || []).some((field) => !credentialValues[field.name])} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{credentialMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}Store securely</button>
        </div>
      </div>
    </div>}

    {preview && pv && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-gray-200 p-5 dark:border-slate-800">
          <div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Confirm this upload</h2><p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">{preview.upload.originalFilename} · {kb(preview.upload.byteSize)} · sha256 {preview.upload.contentSha256.slice(0, 12)}…</p></div>
          <button onClick={() => setPreview(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>

        {pv.ok ? <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <Wand2 size={15} className="text-blue-700 dark:text-blue-300" />
            <span className="font-semibold text-blue-900 dark:text-blue-200">Detected: {pv.providerLabel}</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">{Math.round((pv.providerConfidence || 0) * 100)}% confidence</span>
            <span className="text-xs text-blue-800 dark:text-blue-300">{pv.providerReason}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Rows read', String(pv.rowsRead)], ['Included', String(pv.summary?.included)], ['Excluded', String(pv.summary?.excluded)], ['Included total', usd(pv.summary?.includedTotal)]].map(([l, v]) => <div key={l} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700"><p className="text-[11px] uppercase text-gray-500 dark:text-slate-400">{l}</p><p className="mt-1 font-bold text-gray-900 dark:text-white">{v}</p></div>)}
          </div>

          {(pv.groupedBySection || (pv.subtotalRowsIgnored || 0) > 0) && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            {pv.groupedBySection ? 'This is a grouped report, so the vendor was read from each section heading. ' : ''}
            {(pv.subtotalRowsIgnored || 0) > 0 ? pv.subtotalRowsIgnored + ' subtotal/total row(s) were ignored so amounts are not double counted.' : ''}
          </p>}

          <div><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Columns we read</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(pv.columnMapping || {}).map(([field, header]) => <span key={field} className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 dark:bg-slate-800 dark:text-slate-200"><span className="font-medium">{field}</span> ← {header}</span>)}</div>
            {(pv.unmappedColumns || []).length > 0 && <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">Ignored: {pv.unmappedColumns!.join(', ')}</p>}
          </div>

          <div><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Vendors and the Amazon class that reimburses them</h3>
            <table className="mt-2 w-full text-sm"><thead className="text-left text-[11px] uppercase text-gray-500 dark:text-slate-400"><tr><th className="py-1">Vendor</th><th className="py-1 text-right">Charges</th><th className="py-1 text-right">Total</th><th className="py-1 pl-3">Reimbursed by</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{(pv.summary?.byVendor || []).map((v) => <tr key={v.vendor} className="text-gray-700 dark:text-slate-200"><td className="py-1.5 font-medium">{v.vendor}</td><td className="py-1.5 text-right tabular-nums">{v.count}</td><td className="py-1.5 text-right tabular-nums">{usd(v.total)}</td><td className="py-1.5 pl-3 text-xs text-gray-500 dark:text-slate-400">{v.coverageClass}</td></tr>)}</tbody></table>
          </div>

          {unmapped.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle size={15} />{unmapped.length} vendor(s) not mapped yet</h3>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">These are excluded from the Amazon comparison until you classify them. Nothing is guessed.</p>
            <div className="mt-3 space-y-2">{unmapped.map((u) => <div key={u.vendor} className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-white p-2 dark:border-amber-800 dark:bg-slate-900">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{u.vendor}<span className="ml-1 text-xs text-gray-500 dark:text-slate-400">({u.count})</span></span>
              <select value={draftRules[u.vendor]?.treatment || 'EXCLUDE'} onChange={(e) => setDraftRules((c) => ({ ...c, [u.vendor]: { treatment: e.target.value as 'INCLUDE' | 'EXCLUDE', coverageClass: c[u.vendor]?.coverageClass || 'Excluded from fleet comparison' } }))} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="INCLUDE">Include</option><option value="EXCLUDE">Exclude</option></select>
              <select value={draftRules[u.vendor]?.coverageClass || 'Excluded from fleet comparison'} onChange={(e) => setDraftRules((c) => ({ ...c, [u.vendor]: { treatment: c[u.vendor]?.treatment || 'EXCLUDE', coverageClass: e.target.value } }))} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white">{COVERAGE_CLASSES.map((cc) => <option key={cc} value={cc}>{cc}</option>)}</select>
            </div>)}</div>
            <button onClick={() => mapMutation.mutate(preview.upload.id)} disabled={mapMutation.isPending} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">{mapMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}Save mapping and re-check</button>
          </div>}

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            Periods detected: {(pv.periods || []).join(', ') || 'none'}. Confirming replaces any previously confirmed export for the same period and updates Fleet Costs.
            {pv.summary?.unmatchedVin ? ' ' + pv.summary.unmatchedVin + ' included charges still have no VIN, so they cannot support a per-vehicle claim yet.' : ''}
          </div>
        </div> : <div className="p-5"><div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <strong>We could not read this file.</strong><p className="mt-1">{pv.error}</p>
          {pv.detectedHeaders && <p className="mt-2 text-xs">Headers found: {pv.detectedHeaders.join(', ')}</p>}
          <p className="mt-2 text-xs">Nothing was applied. Fix the export and upload again.</p></div></div>}

        <div className="flex justify-end gap-2 border-t border-gray-200 p-4 dark:border-slate-800">
          <button onClick={() => setPreview(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
          {pv.ok && <button onClick={() => confirmMutation.mutate(preview.upload.id)} disabled={confirmMutation.isPending} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{confirmMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Confirm and use this data</button>}
        </div>
      </div>
    </div>}
  </div>;
};

export default ConnectionsPage;
