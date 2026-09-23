#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectAmazonFeed } from '../platform/src/connectors/amazon-sync-adapters.mjs';
import { launchAmazonPersistentContext, saveAmazonPortableState } from './amazon_persistent_context.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'scripts/amazon_logistics.config.json'), 'utf8'));
const outputRoot = path.join(root, '.openclaw', 'connector-artifacts', 'fleet_condition');
const port = Number(process.env.AMAZON_LOCAL_BROKER_PORT || 8790);
// Keep one visible browser process alive. Amazon's device-bound session can be
// invalidated when short-lived headless processes close; this profile survives
// scheduled checks and allows an operator to complete a rare upstream MFA
// challenge in the same process without rebuilding the connection.
const { context, storageStatePath } = await launchAmazonPersistentContext({ root, config, headless: false });
const page = context.pages()[0] || await context.newPage();
let queue = Promise.resolve();

const runExclusive = (operation) => {
  const result = queue.then(operation, operation);
  queue = result.catch(() => {});
  return result;
};

async function assertFleetConditionAccess() {
  const params = new URLSearchParams({ pageId: 'dsp_supp_reports', companyId: config.companyId, station: config.stationCode, timeFrame: 'Weekly' });
  await page.goto(`${config.performancePortalUrl}?${params}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (page.url().includes('/ap/signin')) throw Object.assign(new Error('Amazon Fleet Condition requires sign-in or MFA'), { code: 'needs_reauth' });
  await page.getByText(/Fleet Condition Assessment.*Wear.*Tear/i).first().waitFor({ timeout: 60_000 });
  await saveAmazonPortableState(context, storageStatePath);
  return { status: 'authenticated', checkedAt: new Date().toISOString(), profile: 'persistent-process' };
}

async function syncFleetCondition() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  let capturedBody;
  const s3 = { async send(command) { capturedBody = Buffer.from(command.input.Body); return {}; } };
  const artifact = await collectAmazonFeed({ page, tenantId: 'jecs', feedGroup: 'fleet_condition', periodStart: today, periodEnd: today,
    bucket: 'local-connector-artifacts', s3 });
  if (!artifact.normalized?.report || !artifact.normalized?.vehicles?.length) throw new Error('Amazon FCA pull did not return VIN-complete data');
  const payload = { source: 'amazon_connector', artifactKey: artifact.key, sha256: artifact.sha256,
    capturedAt: artifact.capturedAt, report: artifact.normalized.report, vehicles: artifact.normalized.vehicles };
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const prefix = artifact.sha256.slice(0, 12);
  await fs.writeFile(path.join(outputRoot, `${prefix}.json`), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(outputRoot, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  if (capturedBody) await fs.writeFile(path.join(outputRoot, `${prefix}-raw.json`), capturedBody, { mode: 0o600 });
  await saveAmazonPortableState(context, storageStatePath);
  return { capturedAt: artifact.capturedAt, sha256: artifact.sha256, vehicles: artifact.normalized.vehicles.length,
    wearTearPercent: artifact.normalized.report.currentQuarterWearTearPercent,
    passing: artifact.normalized.report.wearTearPassingCount };
}

function respond(response, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') return respond(response, 200, await runExclusive(assertFleetConditionAccess));
    if (request.method === 'POST' && request.url === '/sync/fleet-condition') return respond(response, 200, await runExclusive(syncFleetCondition));
    return respond(response, 404, { error: 'not found' });
  } catch (error) {
    return respond(response, error.code === 'needs_reauth' ? 401 : 502, { error: error.message, code: error.code || 'connector_error' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Amazon local broker listening on 127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  server.close();
  await context.close().catch(() => {});
  process.exit(0);
});
