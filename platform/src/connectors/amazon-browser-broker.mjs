import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { OidcAuthenticator } from '../oidc-authenticator.mjs';
import { PostgresRepository } from '../postgres-repository.mjs';
import { ConnectorWorkerStore } from './connector-worker-store.mjs';
import { isBlockedBrowserHost, isValidConnectorTenant } from './browser-security.mjs';
import { collectAmazonFeed } from './amazon-sync-adapters.mjs';

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
let stopping = false;

function safeProfilePath(tenant) {
  if (!isValidConnectorTenant(tenant)) throw new Error('invalid connector tenant');
  return path.join(profileRoot, tenant, 'amazon');
}

async function verifyAmazon(page) {
  const checks = [
    ['logistics', 'https://logistics.amazon.com/performance'],
    ['payments', 'https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices'],
    ['fleet', 'https://logistics.amazon.com/dspconsolev2']
  ];
  const results = {};
  for (const [feed, url] of checks) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    results[feed] = page.url().includes('/ap/signin') ? 'needs_reauth' : 'healthy';
    if (results[feed] !== 'healthy') break;
  }
  return results;
}

async function launchJob(message, receiptHandle) {
  const { tenantId, jobId, sessionId, integrationType, jobType } = message;
  if (!isValidConnectorTenant(tenantId) || !sessionPattern.test(jobId) || !sessionPattern.test(sessionId)
      || integrationType !== 'amazon' || jobType !== 'connect') throw new Error('invalid connector job');
  const row = await workerStore.start(tenantId, { jobId, sessionId });
  const profilePath = safeProfilePath(tenantId);
  await fs.mkdir(profilePath, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--host-resolver-rules=MAP metadata.google.internal ~NOTFOUND']
  });
  await context.route('**/*', async (route) => {
    let hostname = '';
    try { hostname = new URL(route.request().url()).hostname.toLowerCase(); } catch { return route.abort(); }
    return isBlockedBrowserHost(hostname) ? route.abort() : route.continue();
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto('https://logistics.amazon.com/performance', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  sessions.set(sessionId, { tenantId, jobId, sessionId, context, page, receiptHandle, expiresAt: new Date(row.expiresAt).getTime(), busy: false });
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
  const context = await chromium.launchPersistentContext(safeProfilePath(tenantId), {
    headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--host-resolver-rules=MAP metadata.google.internal ~NOTFOUND']
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    const artifact = await collectAmazonFeed({ page, tenantId, feedGroup, periodStart, periodEnd, bucket: artifactBucket, s3 });
    await workerStore.completeSync(tenantId, { jobId, feedGroup, periodStart, periodEnd, artifact });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  } catch (error) {
    await workerStore.failSync(tenantId, {
      jobId, feedGroup, message: error?.code === 'needs_reauth' ? 'Amazon session requires reauthentication.' : 'Amazon feed collection failed.',
      needsReauth: error?.code === 'needs_reauth'
    });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle })).catch(() => {});
  } finally { await context.close(); }
}

async function finish(active) {
  if (active.busy) return;
  active.busy = true;
  try {
    if (Date.now() >= active.expiresAt) throw Object.assign(new Error('Secure Amazon session expired'), { code: 'expired' });
    const current = active.page.url();
    if (current.includes('/ap/signin') || !current.includes('logistics.amazon.com')) return;
    const feeds = await verifyAmazon(active.page);
    if (Object.values(feeds).some((status) => status !== 'healthy')) return;
    await workerStore.complete(active.tenantId, {
      jobId: active.jobId, sessionId: active.sessionId,
      profileKey: `profiles/${active.tenantId}/amazon`, feeds
    });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: active.receiptHandle }));
    await active.context.close();
    sessions.delete(active.sessionId);
  } catch (error) {
    if (error?.code !== 'expired') return;
    await workerStore.fail(active.tenantId, { jobId: active.jobId, sessionId: active.sessionId, code: 'expired', message: error.message });
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: active.receiptHandle }));
    await active.context.close();
    sessions.delete(active.sessionId);
  } finally { active.busy = false; }
}

async function consume() {
  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 4, WaitTimeSeconds: 20, VisibilityTimeout: 900 }));
    for (const item of response.Messages || []) {
      try {
        const body = JSON.parse(item.Body);
        if (body.jobType === 'sync') await runSyncJob(body, item.ReceiptHandle);
        else await launchJob(body, item.ReceiptHandle);
      }
      catch (error) {
        const body = JSON.parse(item.Body || '{}');
        if (body.tenantId && body.jobId && body.sessionId) await workerStore.fail(body.tenantId, {
          jobId: body.jobId, sessionId: body.sessionId, code: 'launch_failed', message: 'Managed Amazon browser could not start.'
        }).catch(() => {});
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: item.ReceiptHandle })).catch(() => {});
      }
    }
  }
}

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
app.get('/health', async () => ({ status: 'ok', sessions: sessions.size }));
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
  await Promise.all([...sessions.values()].map((active) => active.context.close().catch(() => {})));
  await app.close(); await workerStore.close(); await authRepository.close();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
consume().catch((error) => { app.log.error({ err: error }, 'connector queue stopped'); process.exitCode = 1; });
await app.listen({ host: '0.0.0.0', port: Number(process.env.CONNECTOR_PORT || 8790) });
