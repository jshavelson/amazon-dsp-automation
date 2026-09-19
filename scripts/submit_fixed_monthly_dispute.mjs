#!/usr/bin/env node
/** Submit one hash-bound, email-approved Fixed Monthly dispute. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (['--inspect-only', '--execute'].includes(key)) { args[key.slice(2)] = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function isoLabel(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function guard(command, state, extra = []) {
  const output = execFileSync('python3', [
    path.join(ROOT, 'scripts/fixed_monthly_submission_guard.py'), command,
    '--state', state, ...extra,
  ], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(output.trim());
}

async function selectStation(page, stationCode) {
  const station = page.getByRole('combobox', { name: 'Station' });
  if (await station.count() && clean(await station.innerText()) !== stationCode) {
    await station.click();
    const option = page.locator(`[role="option"][aria-label="${stationCode}"]`).first();
    await option.waitFor({ timeout: 10_000 });
    await option.click();
    await page.waitForTimeout(1000);
  }
}

async function openInvoice(page, invoiceNumber) {
  const label = page.getByText(invoiceNumber, { exact: true }).first();
  await label.waitFor({ timeout: 30_000 });
  const card = label.locator('xpath=ancestor::div[./div/header][1]');
  const detailLink = card.locator('span[id$="-invoice-link"]').first();
  await detailLink.click();
  await page.waitForLoadState('domcontentloaded');
  await page.getByText(invoiceNumber, { exact: true }).waitFor({ timeout: 30_000 });
  const body = clean(await page.locator('body').innerText());
  if (!body.includes('Pending action') || !body.includes('Submit a dispute')) {
    throw new Error('invoice is not in a disputable Pending action state');
  }
}

async function selectWeek(page, week) {
  const picker = page.getByRole('combobox').first();
  await picker.click();
  const option = page.locator(`[role="option"][aria-label^="Week ${week}:"]`).first();
  await option.waitFor({ timeout: 10_000 });
  await option.click();
  await page.waitForTimeout(250);
}

async function lmrRows(page) {
  const inputs = page.locator('input[id^="ReconciliationDisputeWizardTable-RowGroup-"]');
  const result = [];
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    const id = await input.getAttribute('id');
    const row = input.locator('xpath=ancestor::tr[1]');
    const rowText = clean(await row.innerText());
    if (!rowText.includes('Branded Last Mile Rental Van')) continue;
    const group = Number(id.match(/RowGroup-(\d+)-/)?.[1]);
    result.push({ group, input, current: Number(await input.inputValue()), rowText });
  }
  return result.sort((a, b) => a.group - b.group);
}

async function visibleDates(page) {
  const rows = page.locator('tbody tr');
  const result = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const text = clean(await rows.nth(index).innerText());
    const match = text.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4})\b/);
    if (match && !result.includes(match[1])) result.push(match[1]);
  }
  return result;
}

async function buildPlan(page, candidate, applyChanges) {
  const changes = [];
  for (const fact of candidate.facts) {
    await selectWeek(page, fact.week);
    const dates = await visibleDates(page);
    const rows = await lmrRows(page);
    if (dates.length !== rows.length) throw new Error(`W${fact.week} date/LMR row count mismatch`);
    for (const target of fact.date_targets) {
      const label = isoLabel(target.date);
      const index = dates.indexOf(label);
      if (index < 0) throw new Error(`W${fact.week} date not found in portal: ${label}`);
      const row = rows[index];
      if (row.current !== Number(target.amazon_lmr_paid)) {
        throw new Error(`${target.date} portal LMR ${row.current} does not match approved evidence ${target.amazon_lmr_paid}`);
      }
      const finalQuantity = Number(target.amazon_lmr_final_quantity);
      if (finalQuantity <= row.current) throw new Error(`${target.date} final LMR quantity is not an increase`);
      changes.push({ week: fact.week, date: target.date, item: 'Branded Last Mile Rental Van', from: row.current, to: finalQuantity });
      if (applyChanges) await row.input.fill(String(finalQuantity));
    }
  }
  return changes;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.state || Boolean(args['inspect-only']) === Boolean(args.execute)) {
    throw new Error('Usage: submit_fixed_monthly_dispute.mjs --state PATH (--inspect-only | --execute)');
  }
  const statePath = path.resolve(ROOT, args.state);
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  let intent;
  if (args.execute) {
    intent = guard('ready', statePath);
  } else {
    if (!state.candidate) throw new Error('state has no dispute candidate');
    intent = { approval_id: state.approval_id, invoice_number: state.invoice.invoice_number, candidate: state.candidate };
  }
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const storageState = path.resolve(ROOT, config.paymentsStorageStatePath || config.storageStatePath);
  const browser = await chromium.launch({ headless: true });
  let claim = null;
  try {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('https://logistics.amazon.com/flexpayments/simpson/flexpro/invoices', {
      waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45_000,
    });
    if (page.url().includes('/ap/signin')) throw new Error('Amazon Payments session expired');
    await page.getByRole('heading', { name: 'All invoices' }).waitFor({ timeout: 45_000 });
    await selectStation(page, config.stationCode);
    await openInvoice(page, intent.invoice_number);
    await page.getByRole('button', { name: 'Submit a dispute', exact: true }).click();
    await page.getByText(/Step 1 of 3:/).waitFor({ timeout: 15_000 });
    const changes = await buildPlan(page, intent.candidate, args.execute);
    if (!args.execute) {
      console.log(JSON.stringify({ inspected: true, approval_id: intent.approval_id, invoice: intent.invoice_number, changes }));
      return;
    }

    await page.getByRole('button', { name: /Next: Add notes/i }).click();
    await page.getByText(/Step 2 of 3:/).waitFor({ timeout: 15_000 });
    const note = `${intent.candidate.proposed_wording}\n\nApproval ID: ${intent.approval_id}`;
    const noteField = page.locator('textarea:not(#feedback-comments)').first();
    await noteField.waitFor({ timeout: 10_000 });
    await noteField.fill(note);
    const reviewButton = page.getByRole('button', { name: /Next: Review dispute/i }).first();
    await reviewButton.click();
    await page.getByText(/Step 3 of 3:/).waitFor({ timeout: 15_000 });
    const reviewBody = clean(await page.locator('body').innerText());
    for (const change of changes) {
      if (!reviewBody.includes(isoLabel(change.date)) || !reviewBody.includes(String(change.to))) {
        throw new Error(`review page does not confirm approved change for ${change.date}`);
      }
    }
    if (!reviewBody.includes(intent.approval_id)) throw new Error('review page does not include approval ID');
    const finalButton = page.getByRole('button', { name: /^Submit dispute$/i }).last();
    await finalButton.waitFor({ timeout: 10_000 });
    if (await finalButton.isDisabled()) throw new Error('final Amazon submit button is disabled');

    claim = guard('claim', statePath);
    try {
      await finalButton.click();
      await page.waitForTimeout(1500);
      const resultBody = clean(await page.locator('body').innerText());
      const confirmation = resultBody.match(/(?:case|dispute)(?: id| number)?[:# ]+([A-Z0-9-]{5,})/i)?.[1];
      if (!confirmation && !/dispute (?:was )?submitted|successfully submitted/i.test(resultBody)) {
        throw new Error('Amazon did not display a verifiable submission confirmation');
      }
      const recorded = guard('finish', statePath, [
        '--claim-token', claim.claim_token, '--outcome', 'submitted',
        '--confirmation', confirmation || `portal-success-${new Date().toISOString()}`,
      ]);
      await context.storageState({ path: storageState });
      await fs.chmod(storageState, 0o600);
      console.log(JSON.stringify({ submitted: true, ...recorded, changes }));
    } catch (error) {
      guard('finish', statePath, [
        '--claim-token', claim.claim_token, '--outcome', 'submission_unknown',
        '--confirmation', error instanceof Error ? error.message : String(error),
      ]);
      throw error;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
