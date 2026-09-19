#!/usr/bin/env node
/** Download the newest unprocessed final Fleet Reconciliation Invoice. */
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
    if (key === '--dry-run') { args['dry-run'] = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function invoiceCards(page) {
  const invoiceLabels = page.getByText(/^INV-[A-Z0-9-]+$/, { exact: true });
  const cards = [];
  for (let index = 0; index < await invoiceLabels.count(); index += 1) {
    const label = invoiceLabels.nth(index);
    const card = label.locator('xpath=ancestor::div[./div/header][1]');
    const text = clean(await card.innerText().catch(() => ''));
    const invoiceNumber = clean(await label.innerText());
    const downloadButton = card.locator('button[id^="download-"]').first();
    if (await downloadButton.count() && invoiceNumber) cards.push({ downloadButton, text, invoiceNumber });
  }
  return cards;
}

async function main() {
  const args = parseArgs(process.argv);
  const outputRoot = path.resolve(ROOT, args['output-root'] || 'data/fleet_reviews/fixed-monthly/inbox');
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const storageState = path.resolve(ROOT, config.paymentsStorageStatePath || config.storageStatePath);
  await fs.access(storageState).catch(() => {
    throw new Error('Saved Amazon Payments session is missing. Run node scripts/amazon_payments_login.mjs once.');
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
      waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45_000,
    });
    if (page.url().includes('/ap/signin')) {
      throw new Error('Amazon Payments requires a fresh handshake. Run node scripts/amazon_payments_login.mjs once.');
    }
    await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 45_000 });
    const station = page.getByRole('combobox', { name: 'Station' });
    if (await station.count() && clean(await station.innerText()) !== config.stationCode) {
      await station.click();
      const option = page.getByRole('option', { name: config.stationCode, exact: true });
      await option.waitFor({ timeout: 10_000 });
      await option.click();
      await page.waitForTimeout(1500);
    }
    await page.getByText(/^INV-[A-Z0-9-]+$/, { exact: true }).first().waitFor({ timeout: 45_000 });
    const cards = await invoiceCards(page);
    const reconciliations = cards.filter((card) =>
      /Fleet invoice/i.test(card.text) && /Reconciliation Invoice/i.test(card.text)
    );
    if (!reconciliations.length) {
      console.log(JSON.stringify({ noNewInvoice: true, reason: 'no_fleet_reconciliation_invoice_visible' }));
      return;
    }
    for (const card of reconciliations) {
      const directory = path.join(outputRoot, card.invoiceNumber);
      const manifestPath = path.join(directory, 'download-manifest.json');
      try {
        await fs.access(manifestPath);
        continue;
      } catch {}
      if (args['dry-run']) {
        console.log(JSON.stringify({ found: true, invoiceNumber: card.invoiceNumber, summary: card.text, dryRun: true }));
        return;
      }
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = path.join(directory, `${card.invoiceNumber}.pdf`);
      await card.downloadButton.click();
      const pdfAction = page.getByText('Download PDF', { exact: true }).last();
      await pdfAction.waitFor({ timeout: 10_000 });
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 45_000 }),
        pdfAction.click(),
      ]);
      await download.saveAs(destination);
      await fs.chmod(destination, 0o600);
      const manifest = {
        invoiceNumber: card.invoiceNumber,
        downloadedAt: new Date().toISOString(),
        summary: card.text,
        downloadAction: 'Download PDF',
        pdf: destination,
      };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await context.storageState({ path: storageState });
      await fs.chmod(storageState, 0o600);
      console.log(JSON.stringify({ downloaded: true, manifest: manifestPath, ...manifest }));
      return;
    }
    console.log(JSON.stringify({ noNewInvoice: true, reason: 'all_visible_reconciliation_invoices_processed' }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
