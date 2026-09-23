#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageStatePath = path.join(repoRoot, '.openclaw', 'pave-storage-state.json');
const checkOnly = process.argv.includes('--check');
const headless = checkOnly || process.argv.includes('--headless');
const loginUrl = 'https://dashboard.paveapi.com/login';
const username = process.env.PAVE_USERNAME;
const password = process.env.PAVE_PASSWORD;

await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
const hasSavedSession = await fs.access(storageStatePath).then(() => true).catch(() => false);
if (checkOnly && !hasSavedSession) throw new Error('Saved PAVE session is missing.');

const browser = await chromium.launch({ headless });
try {
  const context = await browser.newContext(hasSavedSession ? { storageState: storageStatePath } : {});
  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const signedIn = async () => {
    if (page.url().includes('paveapi.com') && !page.url().includes('/login')) return true;
    const passwordFields = await page.locator('input[type="password"]').count();
    const loginControls = await page.getByRole('button', { name: /teken aan|sign in|log in/i }).count();
    return passwordFields === 0 && loginControls === 0;
  };

  if (checkOnly) {
    if (!(await signedIn())) throw new Error('PAVE session requires sign-in.');
  } else {
    console.log(hasSavedSession ? 'Opening PAVE with the saved session...' : 'Opening PAVE login...');
    if (!(await signedIn())) {
      if (username && password) {
        await page.locator('#username').fill(username);
        await page.locator('#password').fill(password);
        await page.locator('#password').evaluate((input) => input.form?.requestSubmit());
      } else {
        console.log('Complete PAVE sign-in in the private browser. Credentials are not stored by the application.');
      }
      await page.waitForURL((url) => url.hostname === 'dashboard.paveapi.com' && url.pathname !== '/login', {
        timeout: 300_000, waitUntil: 'domcontentloaded'
      });
    }
    if (!(await signedIn())) throw new Error('PAVE authentication did not complete.');
  }

  await context.storageState({ path: storageStatePath });
  await fs.chmod(storageStatePath, 0o600);
  console.log(JSON.stringify({ status: 'authenticated', checkedAt: new Date().toISOString(), provider: 'PAVE' }));
} finally {
  await browser.close();
}
