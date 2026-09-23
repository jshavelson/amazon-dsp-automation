import crypto from 'node:crypto';
import { connectionDefinition, CONNECTION_CATALOG } from './connection-catalog.mjs';
import { parseSecretReference } from '../secrets/secret-reference.mjs';

const ALLOWED_ENVIRONMENTS = new Set(['development', 'production']);

function publicConnection(definition, stored, managedBrowserAvailable = false) {
  const configuredFields = stored?.config?.configuredFields || [];
  return {
    ...definition,
    reconnectAvailable: definition.authKind === 'browser_session' && managedBrowserAvailable,
    credentialFields: definition.credentialFields.map(({ name, label, secret, placeholder }) => ({
      name, label, secret, placeholder, configured: configuredFields.includes(name)
    })),
    configured: definition.authKind === 'browser_session'
      ? Boolean(stored?.config?.profileKey)
      : Boolean(stored?.secret_reference),
    status: stored?.status || 'not_connected',
    setupStatus: stored?.setup_status || stored?.status || 'not_connected',
    dataAvailable: definition.authKind === 'browser_session'
      ? Boolean(stored?.last_data_at || stored?.last_success_at)
      : stored?.status === 'healthy',
    sourceMode: stored?.source_mode || (stored?.secret_reference ? 'aws_managed' : null),
    lastSuccessAt: stored?.last_success_at || null,
    lastAuthSuccessAt: stored?.last_auth_success_at || null,
    lastDataAt: stored?.last_data_at || stored?.last_success_at || null,
    lastCheckedAt: stored?.last_checked_at || null,
    lastError: stored?.last_error || null,
    environment: stored?.config?.environment || null,
    secretReference: stored?.secret_reference || null
  };
}

function validateCredentialPayload(definition, body) {
  const environment = body?.environment || 'production';
  if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new Error('invalid connector environment');
  const credentials = body?.credentials;
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('credentials are required');
  }
  const expected = new Set(definition.credentialFields.map((item) => item.name));
  if (!expected.size) throw new Error('this connection does not accept credentials');
  for (const name of Object.keys(credentials)) {
    if (!expected.has(name)) throw new Error('unexpected credential field');
  }
  for (const name of expected) {
    const value = credentials[name];
    if (typeof value !== 'string' || value.length < 3 || value.length > 4096) {
      throw new Error(`invalid credential field: ${name}`);
    }
  }
  return { environment, credentials };
}

export class ConnectionService {
  #repository;
  #secretProvider;
  #connectorQueue;
  #connectorSessionTtlMinutes;

  constructor({ repository, secretProvider, baseline = null, connectorQueue = null, connectorSessionTtlMinutes = 15 }) {
    if (!repository?.listIntegrationConnections || !repository?.upsertIntegrationConnection) {
      throw new Error('connection repository is required');
    }
    if (!secretProvider?.write || !secretProvider?.read) throw new Error('managed secret provider is required');
    this.#repository = repository;
    this.#secretProvider = secretProvider;
    this.#connectorQueue = connectorQueue;
    this.#connectorSessionTtlMinutes = connectorSessionTtlMinutes;
    this.baseline = baseline;
  }

  async list(context) {
    const stored = await this.#repository.listIntegrationConnections(context);
    const byType = new Map(stored.map((item) => [item.integration_type, item]));
    if (!byType.has('amazon')) {
      const legacy = ['amazon_logistics', 'amazon_payments', 'fleet_portal']
        .map((id) => byType.get(id)).filter(Boolean);
      if (legacy.length) {
        const rank = { healthy: 4, pending: 3, not_connected: 2, degraded: 1, needs_reauth: 0 };
        byType.set('amazon', legacy.sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2))[0]);
      }
    }
    const baselineByType = new Map((this.baseline?.connections || []).map((item) => [item.id, item]));
    const connections = CONNECTION_CATALOG.map((definition) => {
      const persisted = byType.get(definition.id);
      const baseline = baselineByType.get(definition.id);
      const baselineHealthy = baseline?.status === 'healthy' && baseline?.lastSuccessAt;
      const persistedRequiresAttention = ['needs_reauth', 'degraded'].includes(persisted?.status);
      const effective = {
        ...(persisted || {}),
        status: persistedRequiresAttention ? persisted.status : baselineHealthy ? 'healthy' : persisted?.status,
        setup_status: persisted?.status || 'not_connected',
        last_success_at: persisted?.last_success_at || baseline?.lastSuccessAt || null,
        last_checked_at: persisted?.last_checked_at || baseline?.lastCheckedAt || null,
        source_mode: baselineHealthy && !persisted?.last_success_at ? 'deployment_snapshot' : (persisted?.secret_reference ? 'aws_managed' : null)
      };
      return publicConnection(definition, effective, Boolean(this.#connectorQueue));
    });
    const persistentConnections = connections.filter((item) => item.authKind !== 'manual_upload');
    const active = persistentConnections.filter((item) => item.status === 'healthy').length;
    return {
      tenant: context.principal.tenantId,
      servedAt: new Date().toISOString(),
      summary: {
        total: connections.length,
        connectionTotal: persistentConnections.length,
        connected: active,
        active,
        health: persistentConnections.length && active === persistentConnections.length ? 'green' : active ? 'yellow' : 'red',
        needsAttention: persistentConnections.filter((item) => ['needs_reauth', 'degraded'].includes(item.status)).length,
        notConnected: persistentConnections.filter((item) => item.status === 'not_connected').length
      },
      connections,
      uploads: [],
      secretPolicy: {
        storage: 'AWS Secrets Manager',
        pathTemplate: 'secret://{tenant}/aws/{connection}/credentials',
        note: 'Credential values are write-only. The browser and database receive only configuration status and a secret reference.'
      }
    };
  }

  async refresh(context) {
    const payload = await this.list(context);
    return {
      status: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      sources: payload.connections.filter((item) => item.authKind !== 'manual_upload').map((item) => ({
        id: item.id,
        status: item.status,
        message: item.sourceMode === 'deployment_snapshot'
          ? 'Latest verified deployment snapshot retained'
          : item.status === 'healthy' ? 'AWS-managed source is healthy' : 'Source requires setup or attention'
      }))
    };
  }

  async configure(context, connectionId, body) {
    const definition = connectionDefinition(connectionId);
    if (!['api_credentials', 'imap_password'].includes(definition.authKind)) {
      throw new Error('this connection uses a different setup flow');
    }
    const { environment, credentials } = validateCredentialPayload(definition, body);
    const secretIntegration = connectionId.replaceAll('_', '-');
    const reference = `secret://${context.principal.tenantId}/aws/${secretIntegration}/credentials`;
    await this.#secretProvider.write(parseSecretReference(reference), {
      tenantId: context.principal.tenantId,
      actorSubject: context.principal.userId,
      purpose: 'tenant connection configuration',
      value: JSON.stringify({ environment, credentials })
    });
    await this.#repository.upsertIntegrationConnection(context, {
      integrationType: definition.id,
      displayName: definition.displayName,
      secretReference: reference,
      authKind: definition.authKind,
      schedule: definition.schedule,
      status: 'pending',
      config: { environment, configuredFields: definition.credentialFields.map((item) => item.name) }
    });
    return publicConnection(definition, {
      secret_reference: reference,
      status: 'pending',
      config: { environment, configuredFields: definition.credentialFields.map((item) => item.name) }
    }, Boolean(this.#connectorQueue));
  }

  async test(context, connectionId) {
    const definition = connectionDefinition(connectionId);
    if (!definition.testable) throw new Error('connection test is not available for this provider');
    const stored = await this.#repository.getIntegrationConnection(context, connectionId);
    if (!stored?.secret_reference) throw new Error('connection is not configured');
    let outcome;
    try {
      const parsed = parseSecretReference(stored.secret_reference);
      const serialized = await this.#secretProvider.read(parsed, {
        tenantId: context.principal.tenantId,
        purpose: 'connection health test'
      });
      const bundle = JSON.parse(serialized);
      outcome = await testDigits(bundle.credentials);
      await this.#repository.updateIntegrationConnectionHealth(context, connectionId, {
        status: 'healthy', lastError: null, succeeded: true
      });
    } catch (error) {
      await this.#repository.updateIntegrationConnectionHealth(context, connectionId, {
        status: 'degraded', lastError: 'Provider authentication failed', succeeded: false
      });
      throw error;
    }
    return { status: 'healthy', provider: definition.displayName, ...outcome };
  }

  async beginReconnect(context, connectionId) {
    const definition = connectionDefinition(connectionId);
    if (definition.authKind !== 'browser_session') throw new Error('connection does not use browser reconnect');
    if (!['amazon', 'pave'].includes(connectionId)) throw new Error('reconnect adapter is unavailable');
    if (!this.#connectorQueue || !this.#repository.createConnectorSession) {
      throw new Error('managed connector worker is unavailable');
    }
    const existing = await this.#repository.getIntegrationConnection(context, connectionId);
    const expiresAt = new Date(Date.now() + this.#connectorSessionTtlMinutes * 60_000).toISOString();
    const created = await this.#repository.createConnectorSession(context, {
      integrationType: connectionId,
      purpose: existing ? 'reauthenticate' : 'connect',
      expiresAt,
      idempotencyKey: `connect:${connectionId}:${crypto.randomUUID()}`
    });
    await this.#repository.upsertIntegrationConnection(context, {
      integrationType: definition.id,
      displayName: definition.displayName,
      secretReference: null,
      authKind: definition.authKind,
      schedule: definition.schedule,
      status: 'needs_reauth',
      config: { authorizationMode: 'managed_tenant_browser', activeSessionId: created.session.id }
    });
    if (created.job) {
      await this.#connectorQueue.enqueue({
        jobId: created.job.id,
        sessionId: created.session.id,
        tenantId: context.principal.tenantId,
        integrationType: connectionId,
        jobType: 'connect',
        requestedAt: created.job.requestedAt || new Date().toISOString()
      });
      await this.#repository.markConnectorJobQueued?.(context, created.job.id);
    }
    return {
      connection: connectionId,
      status: created.session.status,
      sessionId: created.session.id,
      sessionStatusUrl: `/api/connections/sessions/${created.session.id}`,
      expiresAt: created.session.expiresAt,
      launchMode: 'managed_tenant_browser',
      launchUrl: created.session.launchUrl || null,
      message: created.reused
        ? `Your existing secure ${definition.displayName} reconnect session is still starting.`
        : `A private tenant-isolated ${definition.displayName} browser is starting. Continue when the secure session link becomes available.`
    };
  }

  async reconnectStatus(context, sessionId) {
    const session = await this.#repository.getConnectorSession?.(context, sessionId);
    if (!session) throw new Error('connector session not found');
    return {
      ...session,
      launchUrl: session.status === 'waiting_for_user' ? session.launchUrl : null
    };
  }

  async startBackfill(context, connectionId) {
    if (connectionId !== 'amazon') throw new Error('backfill adapter is unavailable');
    if (!this.#connectorQueue || !this.#repository.createAmazonBackfillJobs) throw new Error('managed connector worker is unavailable');
    const feedGroups = ['fleet_readiness', 'fleet_condition'];
    const jobs = await this.#repository.createAmazonBackfillJobs(context, feedGroups);
    for (const job of jobs) {
      await this.#connectorQueue.enqueue({
        jobId: job.id, tenantId: context.principal.tenantId, integrationType: 'amazon', jobType: 'sync',
        feedGroup: job.feedGroup, periodStart: String(job.periodStart).slice(0, 10), periodEnd: String(job.periodEnd).slice(0, 10),
        requestedAt: job.requestedAt || new Date().toISOString()
      });
      await this.#repository.markConnectorJobQueued?.(context, job.id);
    }
    return { connection: 'amazon', queued: jobs.length, feedGroups: jobs.map((job) => job.feedGroup) };
  }
}

async function testDigits(credentials) {
  const response = await fetch('https://connect.digits.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error('Digits authentication failed');
  const payload = await response.json();
  if (!payload.access_token || payload.scope !== 'ledger:read') throw new Error('Digits read-only scope is unavailable');
  return { message: 'Read-only ledger access verified', expiresIn: payload.expires_in || null };
}
