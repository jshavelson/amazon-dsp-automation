import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchAmazonPersistentContext, saveAmazonPortableState } from './amazon_persistent_context.mjs';

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

const { context } = await launchAmazonPersistentContext({ root: repoRoot, config, headless: false, acceptDownloads: true });
const page = await context.newPage();

console.log('Opening Amazon Logistics with the persistent managed profile...');
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
  await context.close();
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

console.log('Payments access confirmed. Verifying Delivery Execution...');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const executionUrl = `https://logistics.amazon.com/operations/execution/dv/routes?provider=ALL_DRIVERS&selectedDay=${today}&serviceAreaId=${config.executionServiceAreaId}&historicalDay=false`;
await page.goto(executionUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
if (page.url().includes('/ap/signin')) {
  console.log('Amazon requested a Delivery Execution challenge. Complete it in the same browser window.');
  await page.waitForURL((url) => url.hostname === 'logistics.amazon.com' && url.pathname.startsWith('/operations/execution/'), {
    timeout: 300_000,
    waitUntil: 'domcontentloaded',
  });
}

await saveAmazonPortableState(context, storageStatePath);
console.log(`Saved persistent Amazon DSP profile and portable state to ${storageStatePath}`);

await context.close();
