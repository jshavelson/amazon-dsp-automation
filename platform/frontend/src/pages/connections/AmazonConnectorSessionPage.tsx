import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Lock, LogOut, RefreshCw } from 'lucide-react';

const connectorHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('auth_token') || sessionStorage.getItem('dsp-platform-id-token') || ''}`,
  'x-tenant-id': sessionStorage.getItem('dsp-active-tenant') || '',
  'content-type': 'application/json',
});

const AmazonConnectorSessionPage: React.FC = () => {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const imageRef = useRef<HTMLImageElement>(null);
  const sessionRef = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState('Connecting to the private provider browser…');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const refreshFrame = useCallback(async () => {
    const response = await fetch(`/connector/api/sessions/${sessionId}/frame`, { headers: connectorHeaders(), cache: 'no-store' });
    if (response.status === 410) {
      setStatus('Provider authentication verified. Returning to Connections…');
      window.setTimeout(() => navigate('/connections'), 1200);
      return;
    }
    if (!response.ok) throw new Error('The secure Amazon browser is unavailable.');
    const next = URL.createObjectURL(await response.blob());
    setFrame((current) => { if (current) URL.revokeObjectURL(current); return next; });
    setStatus('Private tenant browser · Credentials are sent directly to this isolated browser.');
  }, [navigate, sessionId]);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const poll = async () => {
      try { await refreshFrame(); setError(null); }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Browser unavailable'); }
      if (active) timer = window.setTimeout(poll, 800);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [refreshFrame]);

  const send = async (payload: Record<string, unknown>) => {
    setSending(true);
    try {
      const response = await fetch(`/connector/api/sessions/${sessionId}/input`, {
        method: 'POST', headers: connectorHeaders(), body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Browser input was rejected.');
      await refreshFrame();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Browser input failed'); }
    finally { setSending(false); }
  };

  const click = (event: React.MouseEvent<HTMLImageElement>) => {
    sessionRef.current?.focus();
    const box = event.currentTarget.getBoundingClientRect();
    void send({ type: 'click', x: Math.round((event.clientX - box.left) * 1440 / box.width), y: Math.round((event.clientY - box.top) * 900 / box.height) });
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === 'Backspace' || event.key.startsWith('Arrow')) {
      event.preventDefault(); void send({ type: 'key', key: event.key });
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      event.preventDefault(); void send({ type: 'text', text: event.key });
    }
  };

  return <main ref={sessionRef} className="min-h-screen bg-slate-950 p-4 text-white outline-none" onKeyDown={key} tabIndex={0}>
    <header className="mx-auto mb-3 flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-lg font-semibold"><Lock size={18} />Secure provider connection</h1><p className="text-xs text-slate-400">{status}</p></div>
      <div className="flex gap-2"><button onClick={() => void refreshFrame()} className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm"><RefreshCw size={14} />Refresh</button><button onClick={() => navigate('/connections')} className="inline-flex items-center gap-2 rounded bg-slate-700 px-3 py-2 text-sm"><LogOut size={14} />Exit</button></div>
    </header>
    {error && <div className="mx-auto mb-3 flex max-w-[1440px] items-center gap-2 rounded border border-red-800 bg-red-950 p-3 text-sm text-red-200"><AlertTriangle size={16} />{error}</div>}
    <section className="mx-auto max-w-[1440px] overflow-hidden rounded border border-slate-700 bg-black shadow-2xl">
      {frame ? <img ref={imageRef} src={frame} onClick={click} onWheel={(event) => { event.preventDefault(); void send({ type: 'scroll', deltaY: event.deltaY }); }} alt="Private provider browser" className="block w-full cursor-crosshair select-none" draggable={false} /> : <div className="grid aspect-[16/10] place-items-center"><Loader2 className="animate-spin text-blue-400" size={30} /></div>}
    </section>
    <p className="mx-auto mt-3 max-w-[1440px] text-xs text-slate-400">Click inside the browser, then type normally. Paste is intentionally disabled so passwords and MFA values are never copied into application state. This session expires automatically.</p>
    {sending && <span className="fixed bottom-4 right-4 rounded bg-slate-800 px-3 py-2 text-xs text-slate-300">Sending input…</span>}
  </main>;
};

export default AmazonConnectorSessionPage;
