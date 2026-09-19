#!/usr/bin/env node
/** Refresh and validate the Payments-only Amazon browser state. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
const storageState = path.resolve(ROOT, config.paymentsStorageStatePath || config.storageStatePath);
const temporaryState = `${storageState}.refreshing`;
const healthPath = path.join(path.dirname(storageState), 'amazon-payments-session-health.json');

await fs.access(storageState).catch(() => {
  throw new Error('Saved Amazon Payments session is missing. Run node scripts/amazon_payments_login.mjs once.');
});

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
    waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45_000,
  });
  if (page.url().includes('/ap/signin')) {
    throw new Error('Amazon Payments requires sign-in or MFA. Run node scripts/amazon_payments_login.mjs once.');
  }
  await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 45_000 });
  await context.storageState({ path: temporaryState });
  await fs.chmod(temporaryState, 0o600);
  await fs.rename(temporaryState, storageState);
  const state = JSON.parse(await fs.readFile(storageState, 'utf8'));
  const authCookieNames = new Set(['session-token', 'at-main', 'sess-at-main', 'session-id']);
  const authExpirations = state.cookies
    .filter((cookie) => authCookieNames.has(cookie.name) && cookie.expires > 0)
    .map((cookie) => cookie.expires * 1000);
  const health = {
    status: 'authenticated', checkedAt: new Date().toISOString(),
    earliestSavedAuthCookieExpiry: authExpirations.length ? new Date(Math.min(...authExpirations)).toISOString() : null,
    storageState, note: 'Payments authorization is isolated from the general Logistics session.',
  };
  await fs.writeFile(healthPath, `${JSON.stringify(health, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(health));
} finally {
  await fs.rm(temporaryState, { force: true }).catch(() => {});
  await browser.close();
}
