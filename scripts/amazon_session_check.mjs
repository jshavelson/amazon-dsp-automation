#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
const storageState = path.resolve(ROOT, config.storageStatePath);
const temporaryState = `${storageState}.refreshing`;
const healthPath = path.join(path.dirname(storageState), 'amazon-session-health.json');

await fs.access(storageState).catch(() => {
  throw new Error('Saved Amazon session is missing. Run npm run amazon:login once.');
});

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto('https://logistics.amazon.com/uicomponent/navigationmenu?locale=en-US', {
    waitUntil: 'networkidle',
    timeout: config.navigationTimeoutMs || 45_000,
  });
  if (page.url().includes('/ap/signin')) throw new Error('Amazon requires sign-in or MFA. Run npm run amazon:login once to renew the saved session.');
  await page.getByRole('link', { name: 'Work Summary Tool' }).waitFor({ timeout: 30_000 });

  await context.storageState({ path: temporaryState });
  await fs.chmod(temporaryState, 0o600);
  await fs.rename(temporaryState, storageState);
  await fs.chmod(storageState, 0o600);

  const state = JSON.parse(await fs.readFile(storageState, 'utf8'));
  const authCookieNames = new Set(['session-token', 'at-main', 'sess-at-main', 'session-id']);
  const authExpirations = state.cookies
    .filter((cookie) => authCookieNames.has(cookie.name) && cookie.expires > 0)
    .map((cookie) => cookie.expires * 1000);
  const earliestAuthExpiry = authExpirations.length ? new Date(Math.min(...authExpirations)).toISOString() : null;
  const health = {
    status: 'authenticated',
    checked_at: new Date().toISOString(),
    earliest_saved_auth_cookie_expiry: earliestAuthExpiry,
    note: 'Amazon may revoke a session server-side before the cookie expiry; MFA cannot be bypassed.',
  };
  await fs.writeFile(healthPath, `${JSON.stringify(health, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify(health, null, 2));
} finally {
  await fs.rm(temporaryState, { force: true }).catch(() => {});
  await browser.close();
}
