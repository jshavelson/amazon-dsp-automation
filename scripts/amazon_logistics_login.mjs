import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'amazon_logistics.config.json');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const storageStatePath = path.resolve(repoRoot, config.storageStatePath);

function getLoginUrl(rawConfig) {
  const portalUrl = rawConfig.performancePortalUrl ?? rawConfig.baseUrl;
  if (!rawConfig.companyId || !rawConfig.stationCode || !rawConfig.performancePortalUrl) {
    return portalUrl;
  }
  const params = new URLSearchParams({
    pageId: 'dsp_supp_reports',
    companyId: rawConfig.companyId,
    station: rawConfig.stationCode,
    timeFrame: 'Weekly',
  });
  return `${portalUrl}?${params.toString()}`;
}

await fs.mkdir(path.dirname(storageStatePath), { recursive: true });

const hasSavedSession = await fs.access(storageStatePath).then(() => true).catch(() => false);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  acceptDownloads: true,
  ...(hasSavedSession ? { storageState: storageStatePath } : {}),
});
const page = await context.newPage();

console.log(hasSavedSession ? 'Opening Amazon Logistics with the saved session...' : 'Opening Amazon Logistics login...');
await page.goto(getLoginUrl(config), { waitUntil: 'domcontentloaded' });

if (page.url().includes('/ap/signin')) {
  console.log('Amazon revoked or expired the saved session. Log in manually in the opened browser window.');
  console.log('Session state will save automatically after the Performance portal loads.');
}

if (!page.url().includes('/performance')) {
  await page.waitForURL((url) => url.hostname === 'logistics.amazon.com' && url.pathname.startsWith('/performance'), {
    timeout: 300_000,
    waitUntil: 'domcontentloaded',
  });
}

const finalUrl = page.url();
if (!finalUrl.includes('/performance')) {
  console.error(`Login was not completed in the Performance portal (current URL: ${finalUrl}). Session state was not saved.`);
  await browser.close();
  process.exit(1);
}

console.log('Performance access confirmed. Verifying Payments in the same Amazon session...');
await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
  waitUntil: 'domcontentloaded',
  timeout: 45_000,
});
if (page.url().includes('/ap/signin')) {
  console.log('Amazon requested another challenge. Complete it in the same browser window.');
}
await page.waitForURL((url) => url.hostname === 'logistics.amazon.com' && !url.pathname.includes('/ap/signin'), {
  timeout: 300_000,
  waitUntil: 'domcontentloaded',
});

await context.storageState({ path: storageStatePath });
await fs.chmod(storageStatePath, 0o600);
console.log(`Saved shared Amazon DSP session state to ${storageStatePath}`);

await browser.close();
