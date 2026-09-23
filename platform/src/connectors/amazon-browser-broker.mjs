import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { OidcAuthenticator } from '../oidc-authenticator.mjs';
import { PostgresRepository } from '../postgres-repository.mjs';
import { ConnectorWorkerStore } from './connector-worker-store.mjs';
import { isBlockedBrowserHost, isValidConnectorTenant } from './browser-security.mjs';
import { collectAmazonFeed } from './amazon-sync-adapters.mjs';
import { collectPaveExport } from './pave-sync-adapter.mjs';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const sessionPattern = /^[0-9a-f-]{36}$/i;
const profileRoot = process.env.CONNECTOR_PROFILE_ROOT || '/profiles';
const queueUrl = required('CONNECTOR_QUEUE_URL');
const region = process.env.AWS_REGION || 'us-east-2';
const connectionString = process.env.DATABASE_URL || `postgresql://${encodeURIComponent(required('DB_USER'))}:${encodeURIComponent(required('DB_PASSWORD'))}@${required('DB_HOST')}:${process.env.DB_PORT || 5432}/${encodeURIComponent(process.env.DB_NAME || 'dsp_platform')}?sslmode=require`;
const sqs = new SQSClient({ region });
const s3 = new S3Client({ region });
const artifactBucket = required('CONNECTOR_ARTIFACT_BUCKET');
const workerStore = new ConnectorWorkerStore({ connectionString });
const authRepository = new PostgresRepository({ connectionString });
const authenticator = new OidcAuthenticator({
  issuer: required('OIDC_ISSUER'), audience: required('OIDC_AUDIENCE'), jwksUrl: required('OIDC_JWKS_URL')
});
const sessions = new Map();
// Browser profiles alone are insufficient for Amazon's device-bound session.
// Keep one process/context alive per tenant/provider and serialize every use of
// it. EFS remains the crash/task-replacement recovery layer; this pool is the
// normal steady-state authentication layer.
const retainedBrowsers = new Map();
let stopping = false;

async function attachNetworkGuard(context) {
  await context.route('**/*', async (route) => {
    let hostname = '';
    try { hostname = new URL(route.request().url()).hostname.toLowerCase(); } catch { return route.abort(); }
    return isBlockedBrowserHost(hostname) ? route.abort() : route.continue();
  });
}

const providers = Object.freeze({
  amazon: Object.freeze({
    startUrl: 'https://logistics.amazon.com/performance',
    checks: Object.freeze([
      ['logistics', 'https://logistics.amazon.com/performance'],
      ['payments', 'https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices'],
      ['fleet', 'https://logistics.amazon.com/dspconsolev2']
    ]),
    needsReauth: (url) => url.includes('/ap/signin') || !url.includes('logistics.amazon.com')
  }),
  pave: Object.freeze({
    startUrl: 'https://dashboard.paveapi.com/dashboard',
    checks: Object.freeze([['dashboard', 'https://dashboard.paveapi.com/dashboard']]),
    needsReauth: (url) => url.includes('/login') || !url.includes('paveapi.com')
  })
});

function safeProfilePath(tenant, integrationType) {
  if (!isValidConnectorTenant(tenant)) throw new Error('invalid connector tenant');
  if (!providers[integrationType]) throw new Error('unsupported browser provider');
  return path.join(profileRoot, tenant, integrationType);
}

const retainedKey = (tenantId, integrationType) => `${tenantId}:${integrationType}`;

async function retainedBrowser(tenantId, integrationType) {
  const key = retainedKey(tenantId, integrationType);
  const existing = retainedBrowsers.get(key);
  if (existing) return existing;
  const profilePath = safeProfilePath(tenantId, integrationType);
  await fs.mkdir(profilePath, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--host-resolver-rules=MAP metadata.google.internal ~NOTFOUND']
  });
  await attachNetworkGuard(context);
  const entry = { tenantId, integrationType, context, tail: Promise.resolve(), lastUsedAt: Date.now(), interactiveSessionId: null };
  context.on('close', () => {
    if (retainedBrowsers.get(key) === entry) retainedBrowsers.delete(key);
  });
  retainedBrowsers.set(key, entry);
  return entry;
}

async function withRetainedBrowser(tenantId, integrationType, operation) {
  const entry = await retainedBrowser(tenantId, integrationType);
  if (entry.interactiveSessionId) throw Object.assign(new Error('Managed browser is completing an interactive reconnect.'), { code: 'browser_busy' });
  const run = entry.tail.then(async () => {
    entry.lastUsedAt = Date.now();
    const pages = entry.context.pages();
    const page = pages.find((candidate) => !candidate.isClosed()) || await entry.context.newPage();
    return operation({ context: entry.context, page });
  });
  // A rejected job must not poison the tenant's serialization chain.
  entry.tail = run.catch(() => undefined);
  return run;
}

async function verifyProvider(page, integrationType) {
  const provider = providers[integrationType];
  const results = {};
  for (const [feed, url] of provider.checks) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    results[feed] = provider.needsReauth(page.url()) ? 'needs_reauth' : 'healthy';
    if (results[feed] !== 'healthy') break;
  }
  return results;
}

async function launchJob(message, receiptHandle) {
  const { tenantId, jobId, sessionId, integrationType, jobType } = message;
  if (!isValidConnectorTenant(tenantId) || !sessionPattern.test(jobId) || !sessionPattern.test(sessionId)
      || !providers[integrationType] || jobType !== 'connect') throw new Error('invalid connector job');
  const row = await workerStore.start(tenantId, { jobId, sessionId });
  const retained = await retainedBrowser(tenantId, integrationType);
  await retained.tail;
  if (retained.interactiveSessionId) throw new Error('connector reconnect session is already active');
  retained.interactiveSessionId = sessionId;
  const context = retained.context;
  const pages = context.pages();
  const page = pages.find((candidate) => !candidate.isClosed()) || await context.newPage();
  await page.goto(providers[integrationType].startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 1200 }));
  const active = { tenantId, jobId, sessionId, integrationType, context, page, receiptHandle, expiresAt: new Date(row.expiresAt).getTime(), busy: false, expiryTimer: null };
  active.expiryTimer = setTimeout(() => expireSession(active), Math.max(1000, active.expiresAt - Date.now()));
  sessions.set(sessionId, active);
  await workerStore.ready(tenantId, sessionId, `/app/connector-session/${sessionId}`);
}

function validDateRange(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return false;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days <= 92;
}

async function runSyncJob(message, receiptHandle) {
  const { tenantId, jobId, integrationType, jobType, feedGroup, periodStart, periodEnd } = message;
  if (!isValidConnectorTenant(tenantId) || !sessionPattern.test(jobId) || integrationType !== 'amazon'
      || jobType !== 'sync' || !validDateRange(periodStart, periodEnd)) throw new Error('invalid connector sync job');
  await workerStore.startSync(tenantId, { jobId, feedGroup, periodStart, periodEnd });
  try {
    const artifact = await withRetainedBrowser(tenantId, 'amazon', ({ page }) =>
      collectAmazonFeed({ page, tenantId, feedGroup, periodStart, periodEnd, bucket: artifactBucket, s3 }));
    await workerStore.completeSync(tenantId, { jobId, feedGroup, periodStart, periodEnd, artifact });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  } catch (error) {
    if (error?.code === 'browser_busy') {
      await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 60 }));
      return;
    }
    await workerStore.failSync(tenantId, {
      jobId, feedGroup, message: error?.code === 'needs_reauth' ? 'Amazon session requires reauthentication.' : 'Amazon feed collection failed.',
      needsReauth: error?.code === 'needs_reauth'
    });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle })).catch(() => {});
  }
}

async function finish(active) {
  if (active.busy) return;
  active.busy = true;
  try {
    if (Date.now() >= active.expiresAt) throw Object.assign(new Error('Secure Amazon session expired'), { code: 'expired' });
    const provider = providers[active.integrationType];
    const current = active.page.url();
    if (provider.needsReauth(current)) return;
    const feeds = await verifyProvider(active.page, active.integrationType);
    if (Object.values(feeds).some((status) => status !== 'healthy')) return;
    await workerStore.complete(active.tenantId, {
      jobId: active.jobId, sessionId: active.sessionId,
      integrationType: active.integrationType,
      profileKey: `profiles/${active.tenantId}/${active.integrationType}`, feeds
    });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: active.receiptHandle }));
    clearTimeout(active.expiryTimer);
    sessions.delete(active.sessionId);
    const retained = retainedBrowsers.get(retainedKey(active.tenantId, active.integrationType));
    if (retained?.interactiveSessionId === active.sessionId) retained.interactiveSessionId = null;
  } catch (error) {
    if (error?.code !== 'expired') return;
    await workerStore.fail(active.tenantId, { jobId: active.jobId, sessionId: active.sessionId, integrationType: active.integrationType, code: 'expired', message: error.message });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: active.receiptHandle }));
    clearTimeout(active.expiryTimer);
    sessions.delete(active.sessionId);
    const retained = retainedBrowsers.get(retainedKey(active.tenantId, active.integrationType));
    if (retained?.interactiveSessionId === active.sessionId) retained.interactiveSessionId = null;
  } finally { active.busy = false; }
}

async function expireSession(active) {
  if (!sessions.has(active.sessionId)) return;
  await workerStore.fail(active.tenantId, {
    jobId: active.jobId, sessionId: active.sessionId, integrationType: active.integrationType,
    code: 'expired', message: `Secure ${active.integrationType} session expired.`
  }).catch(() => {});
  await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: active.receiptHandle })).catch(() => {});
  sessions.delete(active.sessionId);
  const retained = retainedBrowsers.get(retainedKey(active.tenantId, active.integrationType));
  if (retained?.interactiveSessionId === active.sessionId) retained.interactiveSessionId = null;
}

async function runHealthSweep(receiptHandle) {
  const candidates = await workerStore.listHealthCandidates();
  for (const candidate of candidates) {
    if ([...sessions.values()].some((active) => active.tenantId === candidate.tenantId && active.integrationType === candidate.integrationType)) continue;
    try {
      const { checks, paveArtifact } = await withRetainedBrowser(candidate.tenantId, candidate.integrationType, async ({ page }) => {
        const checks = await verifyProvider(page, candidate.integrationType);
        const needsReauth = Object.values(checks).some((status) => status !== 'healthy');
        const lastDataAt = candidate.lastDataAt ? Date.parse(candidate.lastDataAt) : 0;
        const paveArtifact = !needsReauth && candidate.integrationType === 'pave' && Date.now() - lastDataAt >= 20 * 60 * 60 * 1000
          ? await collectPaveExport({ page, tenantId: candidate.tenantId, bucket: artifactBucket, s3 }) : null;
        return { checks, paveArtifact };
      });
      const needsReauth = Object.values(checks).some((status) => status !== 'healthy');
      await workerStore.recordHealth(candidate.tenantId, candidate.integrationType, {
        healthy: !needsReauth, needsReauth,
        message: needsReauth ? `${candidate.integrationType} session requires reauthentication.` : null
      });
      if (paveArtifact) await workerStore.recordPaveSnapshot(candidate.tenantId, paveArtifact);
    } catch {
      await workerStore.recordHealth(candidate.tenantId, candidate.integrationType, {
        healthy: false, needsReauth: false, message: `${candidate.integrationType} authentication canary failed.`
      }).catch(() => {});
    }
  }
  await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}

async function consume() {
  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 4, WaitTimeSeconds: 20, VisibilityTimeout: 900 }));
    for (const item of response.Messages || []) {
      try {
        const body = JSON.parse(item.Body);
        if (body.jobType === 'health_sweep') await runHealthSweep(item.ReceiptHandle);
        else if (body.jobType === 'sync') await runSyncJob(body, item.ReceiptHandle);
        else await launchJob(body, item.ReceiptHandle);
      }
      catch (error) {
        const body = JSON.parse(item.Body || '{}');
        if (body.tenantId && body.jobId && body.sessionId) await workerStore.fail(body.tenantId, {
          jobId: body.jobId, sessionId: body.sessionId, integrationType: body.integrationType,
          code: 'launch_failed', message: `Managed ${body.integrationType || 'provider'} browser could not start.`
        }).catch(() => {});
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: item.ReceiptHandle })).catch(() => {});
      }
    }
  }
}

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
app.get('/health', async () => ({ status: 'ok', worker: 'running', queueConsumer: !stopping,
  sessions: sessions.size, retainedBrowsers: retainedBrowsers.size }));
app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/connector/api/')) return;
  try {
    const identity = await authenticator.authenticate(request.headers.authorization);
    const tenant = request.headers['x-tenant-id'];
    if (!isValidConnectorTenant(tenant)) return reply.code(400).send({ error: 'valid tenant required' });
    const context = await authRepository.resolveContext({ tenantSlug: tenant, identity });
    if (!context) return reply.code(403).send({ error: 'tenant access denied' });
    request.tenantContext = context;
  } catch {
    return reply.code(401).send({ error: 'authentication failed' });
  }
});

function activeFor(request, reply) {
  const active = sessions.get(request.params.sessionId);
  if (!active || active.tenantId !== request.tenantContext.principal.tenantId) {
    reply.code(404).send({ error: 'connector session unavailable' });
    return null;
  }
  return active;
}

app.get('/connector/api/sessions/:sessionId/frame', async (request, reply) => {
  const active = activeFor(request, reply); if (!active) return;
  await finish(active);
  if (!sessions.has(active.sessionId)) return reply.code(410).send({ error: 'connector session completed' });
  const png = await active.page.screenshot({ type: 'png' });
  return reply.header('cache-control', 'no-store').type('image/png').send(png);
});

app.post('/connector/api/sessions/:sessionId/input', async (request, reply) => {
  const active = activeFor(request, reply); if (!active) return;
  const input = request.body || {};
  if (input.type === 'click' && Number.isFinite(input.x) && Number.isFinite(input.y)) {
    await active.page.mouse.click(Math.max(0, Math.min(1440, input.x)), Math.max(0, Math.min(900, input.y)));
  } else if (input.type === 'key' && typeof input.key === 'string' && input.key.length <= 32) {
    await active.page.keyboard.press(input.key);
  } else if (input.type === 'text' && typeof input.text === 'string' && input.text.length <= 4096) {
    await active.page.keyboard.insertText(input.text);
  } else if (input.type === 'scroll' && Number.isFinite(input.deltaY)) {
    await active.page.mouse.wheel(0, Math.max(-2000, Math.min(2000, input.deltaY)));
  } else return reply.code(400).send({ error: 'invalid browser input' });
  await finish(active);
  return { ok: true };
});

const shutdown = async () => {
  stopping = true;
  await Promise.all([...retainedBrowsers.values()].map((active) => active.context.close().catch(() => {})));
  await app.close(); await workerStore.close(); await authRepository.close();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
consume().catch((error) => { app.log.error({ err: error }, 'connector queue stopped'); process.exitCode = 1; });
await app.listen({ host: '0.0.0.0', port: Number(process.env.CONNECTOR_PORT || 8790) });
