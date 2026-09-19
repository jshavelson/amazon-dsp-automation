#!/usr/bin/env node
/** Read-only inspection of one Amazon Fleet reconciliation invoice review flow. */
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

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const args = parseArgs(process.argv);
  if (!/^INV-[A-Z0-9-]+$/.test(args.invoice || '')) {
    throw new Error('--invoice must be an Amazon invoice number');
  }
  const output = path.resolve(ROOT, args.output || 'data/fleet_reviews/fixed-monthly/portal-inspection.json');
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const storageState = path.resolve(ROOT, config.paymentsStorageStatePath || config.storageStatePath);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState, acceptDownloads: false });
    const page = await context.newPage();
    const requests = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (/invoice|payment|dispute|review/i.test(url.pathname)) {
        requests.push({ method: response.request().method(), path: url.pathname, status: response.status() });
      }
    });
    await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
      waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45_000,
    });
    try {
      await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 45_000 });
    } catch (error) {
      const diagnostics = {
        inspectedAt: new Date().toISOString(),
        invoice: args.invoice,
        url: page.url(),
        title: await page.title().catch(() => ''),
        body: clean(await page.locator('body').innerText().catch(() => '')).slice(0, 2000),
        requestPaths: requests,
        readOnly: true,
        blocker: error instanceof Error ? error.message : String(error),
      };
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 });
      throw error;
    }
    const station = page.getByRole('combobox', { name: 'Station' });
    if (await station.count() && clean(await station.innerText()) !== config.stationCode) {
      await station.click();
      const option = page.getByRole('option', { name: config.stationCode, exact: true });
      await option.waitFor({ timeout: 10_000 });
      await option.click();
      await page.waitForTimeout(1500);
    }
    const row = page.getByText(args.invoice, { exact: false }).first().locator('xpath=ancestor::*[self::tr or @role="row" or self::div][1]');
    const invoiceMatch = page.getByText(args.invoice, { exact: false }).first();
    if (!await invoiceMatch.count()) {
      const diagnostics = {
        inspectedAt: new Date().toISOString(), invoice: args.invoice, url: page.url(),
        title: await page.title(), body: clean(await page.locator('body').innerText()).slice(0, 12000),
        links: await page.locator('a').evaluateAll((nodes) => nodes.slice(0, 200).map((node) => ({
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(), href: node.getAttribute('href'),
        }))),
        buttons: await page.getByRole('button').evaluateAll((nodes) => nodes.slice(0, 100).map((node) => ({
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(), ariaLabel: node.getAttribute('aria-label'),
        }))),
        comboboxes: await page.getByRole('combobox').evaluateAll((nodes) => nodes.map((node) => ({
          ariaLabel: node.getAttribute('aria-label'), value: node.value || null, html: node.outerHTML.slice(0, 1000),
        }))),
        requestPaths: requests, readOnly: true, blocker: 'invoice_not_visible',
      };
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 });
      throw new Error(`Invoice not visible in current invoice list: ${args.invoice}`);
    }
    const invoiceText = clean(await row.innerText().catch(() => invoiceMatch.innerText()));
    const links = await row.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      href: node.getAttribute('href'),
    })));
    const buttons = await row.locator('button').evaluateAll((nodes) => nodes.map((node) => ({
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      ariaLabel: node.getAttribute('aria-label'),
    })));
    const targetAncestors = await invoiceMatch.evaluate((node) => {
      const result = [];
      let current = node;
      for (let index = 0; current && index < 7; index += 1, current = current.parentElement) {
        result.push({ tag: current.tagName, role: current.getAttribute('role'), className: current.className,
          text: (current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
          html: current.outerHTML.slice(0, 3000) });
      }
      return result;
    });
    const pageLinks = await page.locator('a').evaluateAll((nodes) => nodes.map((node) => ({
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(), href: node.getAttribute('href'),
    })).filter((item) => /invoice|0827/i.test(`${item.text} ${item.href}`)));
    const pageButtons = await page.getByRole('button').evaluateAll((nodes) => nodes.map((node) => ({
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(), ariaLabel: node.getAttribute('aria-label'),
    })));
    const card = invoiceMatch.locator('xpath=ancestor::div[./div/header][1]');
    const cardDownloadButton = card.locator('button[id^="download-"]').first();
    let downloadMenu = null;
    if (await cardDownloadButton.count()) {
      await cardDownloadButton.click();
      await page.waitForTimeout(150);
      downloadMenu = {
        buttonId: await cardDownloadButton.getAttribute('id'),
        body: clean(await page.locator('body').innerText()).slice(0, 14000),
        buttons: await page.getByRole('button').evaluateAll((nodes) => nodes.map((node) => ({
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(), id: node.id,
          visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        }))),
        links: await page.locator('a[href*="/invoiceDocument/"]').evaluateAll((nodes) => nodes.map((node) => ({
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(), href: node.getAttribute('href'),
          visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        }))),
      };
      await cardDownloadButton.click();
    }
    const detailLink = card.locator('span[id$="-invoice-link"]').first();
    let detail = null;
    if (await detailLink.count()) {
      await detailLink.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);
      detail = {
        url: page.url(),
        body: clean(await page.locator('body').innerText()).slice(0, 20000),
        buttons: await page.getByRole('button').evaluateAll((nodes) => nodes.map((node) => ({
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(), ariaLabel: node.getAttribute('aria-label'),
        }))),
        textareas: await page.locator('textarea').evaluateAll((nodes) => nodes.map((node) => ({
          name: node.getAttribute('name'), placeholder: node.getAttribute('placeholder'), ariaLabel: node.getAttribute('aria-label'),
        }))),
        inputs: await page.locator('input').evaluateAll((nodes) => nodes.map((node) => ({
          type: node.type, name: node.name, value: node.value, ariaLabel: node.getAttribute('aria-label'),
        })).filter((item) => item.type !== 'hidden')),
      };
      const openDispute = page.getByRole('button', { name: 'Submit a dispute', exact: true });
      if (await openDispute.count()) {
        await openDispute.click();
        await page.waitForTimeout(500);
        detail.disputeForm = {
          body: clean(await page.locator('body').innerText()).slice(0, 24000),
          buttons: await page.getByRole('button').evaluateAll((nodes) => nodes.map((node) => ({
            text: (node.textContent || '').replace(/\s+/g, ' ').trim(), ariaLabel: node.getAttribute('aria-label'),
            disabled: node.disabled,
          }))),
          comboboxes: await page.getByRole('combobox').evaluateAll((nodes) => nodes.map((node) => ({
            ariaLabel: node.getAttribute('aria-label'), text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            id: node.id, expanded: node.getAttribute('aria-expanded'),
          }))),
          textareas: await page.locator('textarea').evaluateAll((nodes) => nodes.map((node) => ({
            name: node.getAttribute('name'), placeholder: node.getAttribute('placeholder'),
            ariaLabel: node.getAttribute('aria-label'), id: node.id,
          }))),
          inputs: await page.locator('input').evaluateAll((nodes) => nodes.map((node) => ({
            type: node.type, name: node.name, value: node.value, ariaLabel: node.getAttribute('aria-label'),
            id: node.id, placeholder: node.placeholder,
          })).filter((item) => item.type !== 'hidden')),
        };
        const weekPicker = page.getByRole('combobox').first();
        if (await weekPicker.count()) {
          await weekPicker.click();
          detail.disputeForm.weekOptions = await page.getByRole('option').allInnerTexts();
          detail.disputeForm.weekMenuBody = clean(await page.locator('body').innerText()).slice(0, 18000);
          detail.disputeForm.weekMenuHtml = await page.locator('[id^="options-list-"]').evaluateAll((nodes) =>
            nodes.map((node) => node.outerHTML.slice(0, 12000)));
          const targetWeek = page.locator('[role="option"][aria-label^="Week 36:"]').first();
          if (await targetWeek.count()) {
            await targetWeek.click();
            await page.waitForTimeout(300);
            detail.disputeForm.week36 = {
              body: clean(await page.locator('body').innerText()).slice(0, 18000),
              inputs: await page.locator('input[type="text"]').evaluateAll((nodes) => nodes.map((node) => ({
                id: node.id, value: node.value,
                rowText: (node.closest('[role="row"]')?.textContent || node.parentElement?.parentElement?.textContent || '')
                  .replace(/\s+/g, ' ').trim(),
              }))),
              lmrInputAncestors: await page.locator('input[id*="RowGroup-0-Row-4-"]').first().evaluate((node) => {
                const result = [];
                let current = node;
                for (let index = 0; current && index < 12; index += 1, current = current.parentElement) {
                  result.push({tag: current.tagName, className: current.className,
                    text: (current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
                    html: current.outerHTML.slice(0, 4000)});
                }
                return result;
              }),
            };
          }
        }
      }
      detail.scriptUrls = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((node) => node.src));
    }
    const payload = {
      inspectedAt: new Date().toISOString(),
      invoice: args.invoice,
      url: page.url(),
      invoiceText,
      links,
      buttons,
      targetAncestors,
      pageLinks,
      pageButtons,
      downloadMenu,
      detail,
      requestPaths: requests,
      readOnly: true,
    };
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    console.log(output);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
