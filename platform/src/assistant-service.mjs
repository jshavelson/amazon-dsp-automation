import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const citations = [
  { id: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { id: 'fleet-compliance', label: 'Fleet Compliance', route: '/fleet-compliance' },
  { id: 'fleet-costs', label: 'Fleet Costs', route: '/fleet-costs' },
  { id: 'disputes', label: 'Dispute Center', route: '/disputes' },
  { id: 'payroll', label: 'Payroll', route: '/payroll' },
  { id: 'routes', label: 'Live Route Monitor', route: '/routes' },
  { id: 'route-performance', label: 'Weekly Route Performance', route: '/route-performance' }
];

const instructionFiles = ['AGENTS.md', 'IDENTITY.md', 'SOUL.md'];
const maxInstructionFileBytes = 24_000;
const maxInstructionsBytes = 48_000;

export function loadProjectInstructions(root = process.env.ASSISTANT_INSTRUCTIONS_DIR || process.cwd()) {
  const sections = [];
  const files = [];
  let total = 0;
  for (const name of instructionFiles) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath).subarray(0, Math.min(maxInstructionFileBytes, maxInstructionsBytes - total));
    if (!source.length) break;
    const content = source.toString('utf8').trim();
    if (!content) continue;
    sections.push(`<project_instruction file="${name}">\n${content}\n</project_instruction>`);
    files.push({ name, sha256: crypto.createHash('sha256').update(source).digest('hex'), bytes: source.length });
    total += source.length;
    if (total >= maxInstructionsBytes) break;
  }
  const text = sections.join('\n\n');
  return { text, files, version: text ? crypto.createHash('sha256').update(text).digest('hex') : null };
}

export class AssistantService {
  constructor({ repository, secretProvider = null, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5-mini' }) {
    this.repository = repository;
    this.secretProvider = secretProvider;
    this.apiKey = apiKey;
    this.model = model;
  }

  secretReference(context) {
    return `secret://${context.principal.tenantId}/aws/openai/credentials`;
  }

  async credentials(context, purpose = 'AI assistant request') {
    if (this.apiKey) return { apiKey: this.apiKey, model: this.model, source: 'environment' };
    if (!this.secretProvider) return null;
    try {
      const { parseSecretReference } = await import('./secrets/secret-reference.mjs');
      const value = await this.secretProvider.read(parseSecretReference(this.secretReference(context)), {
        tenantId: context.principal.tenantId, purpose
      });
      const bundle = JSON.parse(value);
      return bundle?.apiKey ? { ...bundle, source: 'vault' } : null;
    } catch (error) {
      if (error?.name === 'ResourceNotFoundException') return null;
      if (/not configured|not found|no current secret/i.test(error?.message || '')) return null;
      throw error;
    }
  }

  async status(context) {
    const credentials = await this.credentials(context, 'AI assistant configuration status');
    const bundle = loadProjectInstructions();
    return {
      configured: Boolean(credentials), model: credentials?.model || this.model, voiceMode: 'browser', readOnly: true,
      tenant: context.principal.tenantId,
      instructions: { version: bundle.version, files: bundle.files.map((item) => item.name) }
    };
  }

  async configuration(context) {
    const credentials = await this.credentials(context, 'AI assistant configuration metadata');
    return {
      configured: Boolean(credentials), provider: 'OpenAI', model: credentials?.model || this.model,
      organizationConfigured: Boolean(credentials?.organization), projectConfigured: Boolean(credentials?.project),
      storage: 'AWS Secrets Manager', writeOnly: true, lastFour: credentials?.apiKey ? credentials.apiKey.slice(-4) : null
    };
  }

  async configure(context, body) {
    if (!this.secretProvider?.write) throw Object.assign(new Error('managed secret provider is unavailable'), { statusCode: 503 });
    const apiKey = String(body?.apiKey || '').trim();
    const model = String(body?.model || this.model).trim();
    const organization = String(body?.organization || '').trim();
    const project = String(body?.project || '').trim();
    if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) throw Object.assign(new Error('invalid OpenAI API key'), { statusCode: 400 });
    if (!/^[A-Za-z0-9._:-]{2,100}$/.test(model)) throw Object.assign(new Error('invalid model'), { statusCode: 400 });
    for (const [name, value] of [['organization', organization], ['project', project]]) {
      if (value && !/^[A-Za-z0-9_-]{2,160}$/.test(value)) throw Object.assign(new Error(`invalid ${name}`), { statusCode: 400 });
    }
    const { parseSecretReference } = await import('./secrets/secret-reference.mjs');
    await this.secretProvider.write(parseSecretReference(this.secretReference(context)), {
      tenantId: context.principal.tenantId, actorSubject: context.principal.userId,
      purpose: 'AI assistant credential configuration',
      value: JSON.stringify({ apiKey, model, ...(organization ? { organization } : {}), ...(project ? { project } : {}) })
    });
    return { configured: true, provider: 'OpenAI', model, organizationConfigured: Boolean(organization), projectConfigured: Boolean(project), storage: 'AWS Secrets Manager', writeOnly: true, lastFour: apiKey.slice(-4) };
  }

  async testConfiguration(context) {
    const credentials = await this.credentials(context, 'AI assistant credential test');
    if (!credentials) throw Object.assign(new Error('AI assistant is not configured'), { statusCode: 409 });
    const headers = { authorization: `Bearer ${credentials.apiKey}` };
    if (credentials.organization) headers['openai-organization'] = credentials.organization;
    if (credentials.project) headers['openai-project'] = credentials.project;
    const response = await fetch('https://api.openai.com/v1/models', { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Object.assign(new Error('OpenAI credential validation failed'), { statusCode: 502 });
    return { status: 'healthy', provider: 'OpenAI', model: credentials.model || this.model, checkedAt: new Date().toISOString() };
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
    const credentials = await this.credentials(context);
    if (!credentials) throw Object.assign(new Error('AI assistant is not configured'), { statusCode: 503 });
    const history = Array.isArray(body?.history) ? body.history.slice(-10).filter((item) => ['user', 'assistant'].includes(item?.role)).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 4000) })) : [];
    const path = String(body?.page?.path || '/dashboard').slice(0, 160);
    const snapshot = await this.snapshot(context, path);
    const instructionBundle = loadProjectInstructions();
    const platformInstructions = 'You are a read-only Amazon DSP operational analyst. Use only the supplied tenant snapshot. Never invent metrics or claim cross-tenant access. Cite factual claims with supplied source IDs like [dashboard]. Never perform external actions.';
    const developerInstructions = instructionBundle.text
      ? `${platformInstructions}\n\nFollow the approved project instructions below when they do not conflict with the platform safety, read-only, tenant-isolation, or supplied-data rules above. Paths and tool instructions describe capabilities only; do not claim access to tools or files that are not actually supplied to this application assistant.\n\n${instructionBundle.text}`
      : platformInstructions;
    const input = [
      { role: 'developer', content: developerInstructions },
      ...history,
      { role: 'user', content: `Tenant snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${message}` }
    ];
    const started = Date.now();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.apiKey}`, 'content-type': 'application/json', ...(credentials.organization ? { 'openai-organization': credentials.organization } : {}), ...(credentials.project ? { 'openai-project': credentials.project } : {}) },
      body: JSON.stringify({ model: credentials.model || this.model, input, max_output_tokens: 900, safety_identifier: crypto.createHash('sha256').update(`${context.principal.tenantId}:${context.principal.userId}`).digest('hex') }),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw Object.assign(new Error(`AI provider request failed (${response.status})`), { statusCode: 502 });
    const result = await response.json();
    const answer = String(result.output_text || result.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text).join('') || '').trim();
    const conversationId = crypto.randomUUID();
    await this.repository.recordAssistantExchange?.(context, {
      conversationId, requestId, path, model: credentials.model || this.model, providerRequestId: result.id,
      question: message, answer, inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens,
      latencyMs: Date.now() - started, instructionVersion: instructionBundle.version,
      instructionFiles: instructionBundle.files
    });
    return { conversationId, message: answer || 'No answer was produced.', citations, model: credentials.model || this.model, usage: { inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens }, readOnly: true };
  }
}
