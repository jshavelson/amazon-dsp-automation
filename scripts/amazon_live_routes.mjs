#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchAmazonPersistentContext, saveAmazonPortableState } from './amazon_persistent_context.mjs';
import { normalizeRouteSummaries } from './live_route_normalizer.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
const storageState = path.resolve(ROOT, config.storageStatePath);
const deliveryDate = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const tenant = (process.env.DSP_TENANT || 'jecs').toLowerCase().replace(/[^a-z0-9-]/g, '');
if (!tenant) throw new Error('DSP_TENANT must contain letters, digits, or hyphens');
const { context, storageStatePath } = await launchAmazonPersistentContext({ root: ROOT, config, headless: true });
try {
  const page = await context.newPage();
  const url = `https://logistics.amazon.com/operations/execution/dv/routes?provider=ALL_DRIVERS&selectedDay=${deliveryDate}&serviceAreaId=${config.executionServiceAreaId}&historicalDay=${deliveryDate !== new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())}`;
  const responsePromise = page.waitForResponse(
    (response) => response.status() === 200 && response.url().includes('/operations/execution/api/route-summaries?'),
    { timeout: config.navigationTimeoutMs || 45_000 },
  ).catch(() => null);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45_000 });
  if (page.url().includes('/ap/signin')) throw new Error('Amazon session requires sign-in or MFA. Run npm run amazon:login.');
  const response = await responsePromise;
  if (!response) throw new Error('Amazon Delivery Execution did not return route summaries.');
  const summaries = await response.json().catch(() => null);
  if (!summaries) throw new Error('Amazon Delivery Execution returned invalid route summaries.');
  const capturedAt = new Date().toISOString();
  const normalized = normalizeRouteSummaries(summaries, { tenant, capturedAt, deliveryDate });
  const bytes = `${JSON.stringify(normalized, null, 2)}\n`;
  const sha12 = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const outputDir = path.join(ROOT, 'data', 'tenants', tenant, 'amazon', 'live-routes');
  await fs.mkdir(outputDir, { recursive: true });
  const artifact = path.join(outputDir, `${sha12}-${deliveryDate}-routes.json`);
  await fs.writeFile(artifact, bytes, { mode: 0o600 });
  await fs.writeFile(path.join(outputDir, 'latest.json'), bytes, { mode: 0o600 });
  await saveAmazonPortableState(context, storageStatePath);
  console.log(JSON.stringify({ deliveryDate, capturedAt, routeCount: normalized.routeCount, summary: normalized.summary, artifact: path.relative(ROOT, artifact) }, null, 2));
} finally {
  await context.close();
}
