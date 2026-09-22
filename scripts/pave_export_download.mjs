#!/usr/bin/env node
/** Download the current PAVE Fleet Dashboard CSV using the saved session. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageState = path.join(root, '.openclaw', 'pave-storage-state.json');
const outputDirectory = path.join(root, '.openclaw', 'pave-downloads');
await fs.access(storageState);
await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto('https://dashboard.paveapi.com/dashboard', { waitUntil: 'networkidle', timeout: 60_000 });
  if (page.url().includes('/login')) throw new Error('PAVE session requires sign-in');
  await page.locator('#platformToggle').click();
  await page.waitForURL((url) => url.hostname === 'fleet-dashboard.paveapi.com', { timeout: 30_000 });
  const exportButton = page.getByRole('button', { name: /export csv/i });
  await exportButton.waitFor({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    exportButton.click(),
  ]);
  const filename = download.suggestedFilename();
  const destination = path.join(outputDirectory, filename);
  await download.saveAs(destination);
  await fs.chmod(destination, 0o600);
  await context.storageState({ path: storageState });
  await fs.chmod(storageState, 0o600);
  console.log(JSON.stringify({ status: 'downloaded', filename, path: destination }));
} finally {
  await browser.close();
}
