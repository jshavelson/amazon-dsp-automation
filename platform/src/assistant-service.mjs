import crypto from 'node:crypto';

const citations = [
  { id: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { id: 'fleet-compliance', label: 'Fleet Compliance', route: '/fleet-compliance' },
  { id: 'fleet-costs', label: 'Fleet Costs', route: '/fleet-costs' },
  { id: 'disputes', label: 'Dispute Center', route: '/disputes' },
  { id: 'payroll', label: 'Payroll', route: '/payroll' },
  { id: 'routes', label: 'Route Monitor', route: '/routes' }
];

export class AssistantService {
  constructor({ repository, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5-mini' }) {
    this.repository = repository;
    this.apiKey = apiKey;
    this.model = model;
  }

  status(context) {
    return { configured: Boolean(this.apiKey), model: this.model, voiceMode: 'browser', readOnly: true, tenant: context.principal.tenantId };
  }

  async snapshot(context, path) {
    const [dashboard, integrations, cases] = await Promise.all([
      this.repository.latestDashboardSnapshot?.(context).catch(() => null),
      this.repository.listIntegrationConnections?.(context).catch(() => []),
      this.repository.listCases?.(context, 'executive_dashboard').catch(() => [])
    ]);
    return {
      tenant: context.principal.tenantId,
      generatedAt: new Date().toISOString(),
      currentPath: path,
      dashboard,
      connections: integrations?.map?.(({ integration_type, status, last_checked_at }) => ({ integrationType: integration_type, status, lastCheckedAt: last_checked_at })) || [],
      cases: cases?.slice?.(0, 30) || [],
      citations
    };
  }

  async ask(context, body, requestId) {
    const message = String(body?.message || '').trim();
    if (!message || message.length > 4000) throw Object.assign(new Error('message must contain 1-4000 characters'), { statusCode: 400 });
    if (!this.apiKey) throw Object.assign(new Error('AI assistant is not configured'), { statusCode: 503 });
    const history = Array.isArray(body?.history) ? body.history.slice(-10).filter((item) => ['user', 'assistant'].includes(item?.role)).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 4000) })) : [];
    const path = String(body?.page?.path || '/dashboard').slice(0, 160);
    const snapshot = await this.snapshot(context, path);
    const input = [
      { role: 'developer', content: 'You are a read-only Amazon DSP operational analyst. Use only the supplied tenant snapshot. Never invent metrics or claim cross-tenant access. Cite factual claims with supplied source IDs like [dashboard]. Never perform external actions.' },
      ...history,
      { role: 'user', content: `Tenant snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${message}` }
    ];
    const started = Date.now();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input, max_output_tokens: 900, safety_identifier: crypto.createHash('sha256').update(`${context.principal.tenantId}:${context.principal.userId}`).digest('hex') }),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw Object.assign(new Error(`AI provider request failed (${response.status})`), { statusCode: 502 });
    const result = await response.json();
    const answer = String(result.output_text || result.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text).join('') || '').trim();
    const conversationId = crypto.randomUUID();
    await this.repository.recordAssistantExchange?.(context, {
      conversationId, requestId, path, model: this.model, providerRequestId: result.id,
      question: message, answer, inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens,
      latencyMs: Date.now() - started
    });
    return { conversationId, message: answer || 'No answer was produced.', citations, model: this.model, usage: { inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens }, readOnly: true };
  }
}
