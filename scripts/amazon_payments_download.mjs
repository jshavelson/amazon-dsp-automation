#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function findInvoiceLink(page, predicate) {
  const regions = page.getByRole('region');
  for (let index = 0; index < await regions.count(); index += 1) {
    const region = regions.nth(index);
    const text = (await region.innerText()).replace(/\s+/g, ' ').trim();
    const link = region.locator('a[href*="/invoiceDocument/"]').first();
    if (await link.count()) {
      const href = await link.getAttribute('href');
      if (predicate({ text, href: href || '' })) return { link, text, href };
    }
  }
  return null;
}

async function saveInvoice(page, match, outputDir, fallbackName) {
  const invoiceNumber = match.text.match(/INV-[A-Z0-9-]+/)?.[0] || fallbackName;
  const destination = path.join(outputDir, `${invoiceNumber}.pdf`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    match.link.click(),
  ]);
  await download.saveAs(destination);
  return { invoiceNumber, destination, href: match.href, summary: match.text };
}

async function main() {
  const args = parseArgs(process.argv);
  const week = Number(args.week);
  const year = Number(args.year || new Date().getFullYear());
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw new Error('--week must be an ISO week number from 1 to 53');
  }
  const outputDir = path.resolve(ROOT, args['output-dir'] || `data/payment_reconciliation/${year}-wk${String(week).padStart(2, '0')}`);
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const storageState = path.resolve(ROOT, config.storageStatePath);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs || 45_000,
    });
    await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 45_000 });
    await page.locator('a[href*="/invoiceDocument/"]').first().waitFor({ timeout: 45_000 });

    const incentive = await findInvoiceLink(page, ({ href }) =>
      href.includes(`.INC.${year}.${week}_`)
    );
    const variable = await findInvoiceLink(page, ({ text }) =>
      text.includes('Variable invoice') && text.includes(`Week ${week}`)
    );
    if (!variable || !incentive) {
      throw new Error(`Could not find both variable and incentive invoices for ${year} week ${week}`);
    }

    const downloaded = [];
    downloaded.push(await saveInvoice(page, variable, outputDir, `variable-${year}-wk${week}`));
    downloaded.push(await saveInvoice(page, incentive, outputDir, `incentive-${year}-wk${week}`));
    const manifest = {
      year,
      week,
      downloadedAt: new Date().toISOString(),
      files: downloaded,
    };
    const manifestPath = path.join(outputDir, 'download-manifest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await context.storageState({ path: storageState });
    await fs.chmod(storageState, 0o600);
    console.log(manifestPath);
    for (const item of downloaded) console.log(item.destination);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
