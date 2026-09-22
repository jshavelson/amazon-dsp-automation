import { connectionDefinition, CONNECTION_CATALOG } from './connection-catalog.mjs';
import { parseSecretReference } from '../secrets/secret-reference.mjs';

const ALLOWED_ENVIRONMENTS = new Set(['development', 'production']);

function publicConnection(definition, stored) {
  const configuredFields = stored?.config?.configuredFields || [];
  const fullyConfigured = definition.credentialFields.every(({ name }) => configuredFields.includes(name));
  return {
    ...definition,
    reconnectAvailable: definition.authKind === 'browser_session'
      ? ['amazon', 'pave'].includes(definition.id)
      : false,
    credentialFields: definition.credentialFields.map(({ name, label, secret, placeholder }) => ({
      name, label, secret, placeholder, configured: configuredFields.includes(name)
    })),
    configured: definition.id === 'pave' ? Boolean(stored?.secret_reference) && fullyConfigured : Boolean(stored?.secret_reference),
    status: stored?.status || 'not_connected',
    lastSuccessAt: stored?.last_success_at || null,
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

  constructor({ repository, secretProvider }) {
    if (!repository?.listIntegrationConnections || !repository?.upsertIntegrationConnection) {
      throw new Error('connection repository is required');
    }
    if (!secretProvider?.write || !secretProvider?.read) throw new Error('managed secret provider is required');
    this.#repository = repository;
    this.#secretProvider = secretProvider;
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
    const connections = CONNECTION_CATALOG.map((definition) => publicConnection(definition, byType.get(definition.id)));
    const active = connections.filter((item) => item.status === 'healthy').length;
    return {
      tenant: context.principal.tenantId,
      servedAt: new Date().toISOString(),
      summary: {
        total: connections.length,
        connected: active,
        active,
        health: connections.length && active === connections.length ? 'green' : active ? 'yellow' : 'red',
        needsAttention: connections.filter((item) => ['needs_reauth', 'degraded'].includes(item.status)).length,
        notConnected: connections.filter((item) => item.status === 'not_connected').length
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

  async configure(context, connectionId, body) {
    const definition = connectionDefinition(connectionId);
    if (!['api_credentials', 'imap_password'].includes(definition.authKind)
      && !(connectionId === 'pave' && definition.authKind === 'browser_session')) {
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
    });
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
    const authorizationUrls = {
      amazon: 'https://logistics.amazon.com/dspconsolev2',
      pave: 'https://dashboard.paveapi.com/login'
    };
    const authorizationUrl = authorizationUrls[connectionId];
    if (!authorizationUrl) throw new Error('reconnect adapter is unavailable');
    await this.#repository.upsertIntegrationConnection(context, {
      integrationType: definition.id,
      displayName: definition.displayName,
      secretReference: null,
      authKind: definition.authKind,
      schedule: definition.schedule,
      status: 'needs_reauth',
      config: { authorizationMode: 'short_lived_browser' }
    });
    return {
      connection: connectionId,
      status: 'needs_reauth',
      authorizationUrl,
      message: connectionId === 'amazon'
        ? 'Complete Amazon sign-in and MFA once. This shared session authorizes all Amazon-backed features; no Amazon password is stored.'
        : 'Complete PAVE sign-in. This session is separate from Amazon and feeds fleet compliance data.'
    };
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
