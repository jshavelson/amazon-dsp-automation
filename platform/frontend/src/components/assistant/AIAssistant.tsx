import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ExternalLink, Mic, MicOff, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/services/api';
import { usePlatformContext } from '@/hooks/usePlatformContext';

type Citation = { id: string; label: string; route: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; citations?: Citation[] };
type AssistantStatus = { configured: boolean; model: string; readOnly: boolean; voiceMode: string; tenant: string; capabilities?: string[]; externalActionsRequireApproval?: boolean };
type ChatResponse = { message: string; citations: Citation[]; model: string; conversationId: string; readOnly: boolean; toolsUsed?: Array<{ name: string; ok: boolean }> };

const suggestionsByPath: Array<[RegExp, string[]]> = [
  [/fleet/, ['Which vans need immediate attention?', 'Summarize grounding and PAVE risks.']],
  [/performance|weekly-evaluation/, ['Why is performance changing?', 'Who needs coaching first?']],
  [/payroll|time-attendance/, ['What payroll exceptions need review?', 'Summarize attendance risks.']],
  [/disputes/, ['What are the strongest dispute candidates?', 'Prepare the dispute review bundle for the latest week.']],
  [/routes/, ['Summarize current route risk.', 'Where are capacity constraints?']],
];

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const AIAssistant: React.FC = () => {
  const location = useLocation();
  const { data: platform } = usePlatformContext();
  const tenant = platform?.tenant.id || 'tenant';
  const storageKey = `dsp-ai-chat:${tenant}`;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) setMessages(saved.slice(-20));
    } catch { /* ignore invalid local conversation state */ }
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    api.get<AssistantStatus>('/assistant/status')
      .then(setStatus)
      .catch(() => setError('Assistant status is unavailable.'));
  }, [open]);

  useEffect(() => {
    if (messages.length) sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-20)));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, storageKey]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const suggestions = useMemo(() =>
    suggestionsByPath.find(([pattern]) => pattern.test(location.pathname))?.[1]
      || ['What needs my attention today?', 'Summarize the biggest operational risks.'], [location.pathname]);

  const speak = (text: string) => {
    if (!speakReplies || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\[[^\]]+\]/g, ''));
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };

  const send = async (text = input) => {
    const question = text.trim();
    if (!question || loading) return;
    const userMessage: Message = { id: newId(), role: 'user', content: question };
    const prior = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError(null);
    setLoading(true);
    try {
      const result = await api.post<ChatResponse>('/assistant/chat', {
        message: question,
        history: prior,
        page: { path: location.pathname, title: document.title },
      });
      const reply: Message = { id: newId(), role: 'assistant', content: result.message, citations: result.citations };
      setMessages((current) => [...current, reply]);
      speak(result.message);
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(detail || 'The assistant could not answer right now.');
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(); };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported by this browser. You can still type your question.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>).map((result: any) => result[0].transcript).join('');
      setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); setError('Microphone input stopped. Check browser microphone permission.'); };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setError(null);
  };

  return <>
    {open && <section aria-label="AI operations assistant" className="fixed bottom-24 right-4 z-[70] flex h-[min(650px,calc(100vh-7rem))] w-[min(410px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center justify-between bg-gradient-to-r from-blue-700 to-indigo-700 px-4 py-3 text-white">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-white/15"><Sparkles size={19}/></span><div><h2 className="font-semibold">Operations AI</h2><p className="text-xs text-blue-100">{status?.model || 'Tenant-scoped assistant'} · data + workflows</p></div></div>
        <div className="flex items-center gap-1"><button type="button" onClick={() => setSpeakReplies((value) => !value)} className="rounded-lg p-2 hover:bg-white/10" aria-label={speakReplies ? 'Disable spoken replies' : 'Enable spoken replies'}>{speakReplies ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close assistant"><X size={19}/></button></div>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4 dark:bg-slate-950">
        {!messages.length && <div className="space-y-4"><div className="rounded-xl border border-blue-100 bg-white p-4 text-sm leading-6 text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><strong className="block text-gray-900 dark:text-white">Ask about your operational data or run an evaluation.</strong>I can inspect weekly sources and analyze fleet, routes, payroll, disputes, costs, and performance. I can prepare evaluation and dispute-review outputs, but external actions require separate approval.</div><div className="space-y-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-blue-700 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-slate-800">{suggestion}</button>)}</div></div>}
        {messages.map((message) => <article key={message.id} className={message.role === 'user' ? 'ml-10' : 'mr-6'}><div className={`rounded-2xl px-3.5 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`}><p className="whitespace-pre-wrap">{message.content}</p></div>{message.role === 'assistant' && Boolean(message.citations?.length) && <div className="mt-2 flex flex-wrap gap-1.5">{message.citations?.map((citation) => <Link key={citation.id} to={citation.route} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">{citation.label}<ExternalLink size={10}/></Link>)}</div>}</article>)}
        {loading && <div className="mr-16 flex items-center gap-2 rounded-2xl border bg-white px-4 py-3 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900"><Sparkles className="animate-pulse text-blue-600" size={16}/>Analyzing tenant data…</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
        {status && !status.configured && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">The platform OpenAI key has not been configured. A platform administrator must add it before live AI responses are available.</div>}
      </div>
      <form onSubmit={submit} className="border-t border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><div className="flex items-end gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} maxLength={4000} placeholder="Ask about data or run an evaluation…" className="min-h-[46px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"/><button type="button" onClick={toggleListening} className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${listening ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`} aria-label={listening ? 'Stop listening' : 'Talk to assistant'}>{listening ? <MicOff size={19}/> : <Mic size={19}/>}</button><button type="submit" disabled={!input.trim() || loading || status?.configured === false} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message"><Send size={18}/></button></div><p className="mt-2 text-[10px] text-gray-400">AI can make mistakes. Verify cited records. External actions require approval.</p></form>
    </section>}
    <button type="button" onClick={() => setOpen((value) => !value)} className="group fixed bottom-5 right-5 z-[70] grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xl ring-4 ring-white/80 transition hover:scale-105 focus-visible:ring-blue-300 dark:ring-slate-950" aria-label={open ? 'Close AI assistant' : 'Open AI assistant'} title="Ask Operations AI"><span className="absolute inset-1 animate-pulse rounded-full bg-white/10"/>{open ? <X className="relative" size={23}/> : <Bot className="relative" size={25}/>}</button>
  </>;
};

export default AIAssistant;
