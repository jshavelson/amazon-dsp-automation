import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const config = JSON.parse(await fs.readFile(path.join(__dirname, 'amazon_logistics.config.json'), 'utf8'));
const storageStatePath = path.resolve(repoRoot, config.storageStatePath);
const hasSavedSession = await fs.access(storageStatePath).then(() => true).catch(() => false);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  acceptDownloads: true,
  ...(hasSavedSession ? { storageState: storageStatePath } : {}),
});
const page = await context.newPage();

console.log('Opening Amazon Payments. Complete sign-in in the opened window if prompted.');
await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
  waitUntil: 'domcontentloaded',
  timeout: 45_000,
});

await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 300_000 });
await context.storageState({ path: storageStatePath });
await fs.chmod(storageStatePath, 0o600);
console.log(`Saved Payments-authorized session state to ${storageStatePath}`);
await browser.close();
