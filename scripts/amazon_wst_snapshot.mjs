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

function amazonWeekDates(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoMonday = new Date(jan4);
  isoMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + ((week - 1) * 7));
  const sunday = new Date(isoMonday);
  sunday.setUTCDate(isoMonday.getUTCDate() - 1);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

async function getJson(context, url) {
  const response = await context.request.get(url);
  if (response.status() !== 200 || response.url().includes('/ap/signin')) {
    throw new Error(`Amazon session is not authorized for ${url} (status ${response.status()})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Amazon returned a non-JSON response for ${url}; the saved session may need reauthentication`);
  }
}

function add(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function summarize(worksheetsByDate, trainingByDate) {
  const summary = {
    route_hours: {},
    experience_hours: {},
    service_types: {},
    suppressed_work_orders: 0,
    training_days: 0,
    delivered_packages: 0,
    pickup_packages_eligible: 0,
    total_packages_eligible: 0,
    returned_packages: 0,
  };

  for (const rows of Object.values(worksheetsByDate)) {
    for (const row of rows) {
      if (row.type !== 'WORK_ORDER') continue;
      for (const execution of Object.values(row.providerExecutionDetails || {})) {
        for (const detail of execution?.packageDetails || []) {
          summary.delivered_packages += Number(detail.paymentEligibleDeliveredPackages || 0);
          summary.pickup_packages_eligible += Number(detail.paymentEligiblePickupPackages || 0);
          summary.total_packages_eligible += Number(detail.paymentEligibleTotalPackages || 0);
        }
        summary.returned_packages += Number(execution?.shipmentsReturned || 0);
      }
      if (row.suppressed) {
        summary.suppressed_work_orders += 1;
        continue;
      }
      const duration = /^PT(\d+)H$/.exec(row.plannedDuration || '')?.[1];
      const service = row.serviceTypeName || 'Unknown service';
      add(summary.service_types, `${service} | ${row.plannedDuration || 'unknown duration'}`);
      if (duration && service.includes('On-Road Experience')) add(summary.experience_hours, duration);
      else if (duration) add(summary.route_hours, duration);

    }
  }

  for (const events of Object.values(trainingByDate)) {
    summary.training_days += events.filter((event) => event.dspPaymentEligible && !event.paymentReversed).length;
  }
  return summary;
}

function compactWorkOrders(worksheetsByDate) {
  return Object.values(worksheetsByDate)
    .flat()
    .filter((row) => row.type === 'WORK_ORDER')
    .map((row) => ({
      local_date: row.localDate || null,
      route_code: row.routeCode || null,
      work_order_id: row.workOrderId || null,
      worksheet_id: row.worksheetId || null,
      service_type: row.serviceTypeName || null,
      planned_duration: row.plannedDuration || null,
      status: row.status || null,
      suppressed: Boolean(row.suppressed),
      version: row.version || null,
      last_updated_at: row.lastUpdatedTime || null,
    }))
    .sort((left, right) => `${left.local_date}|${left.work_order_id}`.localeCompare(`${right.local_date}|${right.work_order_id}`));
}

async function main() {
  const args = parseArgs(process.argv);
  const week = Number(args.week);
  const year = Number(args.year || new Date().getUTCFullYear());
  if (!Number.isInteger(week) || week < 1 || week > 53) throw new Error('--week must be from 1 to 53');

  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const providerId = args['provider-id'] || config.providerId;
  const serviceAreaId = args['service-area-id'] || config.executionServiceAreaId;
  if (!providerId || !serviceAreaId) throw new Error('providerId and executionServiceAreaId are required in config');

  const storageState = path.resolve(ROOT, config.storageStatePath);
  const outputDir = path.resolve(ROOT, args['output-dir'] || `data/payment_reconciliation/${year}-wk${String(week).padStart(2, '0')}/wst`);
  await fs.mkdir(outputDir, { recursive: true });
  const dates = amazonWeekDates(year, week);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState });
    const worksheetsByDate = {};
    const trainingByDate = {};
    for (const date of dates) {
      const base = 'https://logistics.amazon.com/harmony/api/v2';
      worksheetsByDate[date] = await getJson(context, `${base}/worksheets?localDate=${date}&providerId=${encodeURIComponent(providerId)}&serviceAreaId=${encodeURIComponent(serviceAreaId)}`);
      trainingByDate[date] = await getJson(context, `${base}/training-events?localDate=${date}&providerId=${encodeURIComponent(providerId)}&serviceAreaId=${encodeURIComponent(serviceAreaId)}`);
      await fs.writeFile(path.join(outputDir, `${date}-worksheets.json`), `${JSON.stringify(worksheetsByDate[date], null, 2)}\n`);
      await fs.writeFile(path.join(outputDir, `${date}-training-events.json`), `${JSON.stringify(trainingByDate[date], null, 2)}\n`);
    }

    const capturedAt = new Date().toISOString();
    const output = {
      source: 'Amazon Work Summary Tool',
      year,
      week,
      dates,
      captured_at: capturedAt,
      summary: summarize(worksheetsByDate, trainingByDate),
      work_orders: compactWorkOrders(worksheetsByDate),
    };
    const summaryPath = path.join(outputDir, 'wst-summary.json');
    const snapshotsDir = path.join(outputDir, 'snapshots');
    const snapshotName = `${capturedAt.replaceAll(':', '').replaceAll('.', '-')}-wst-summary.json`;
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(path.join(snapshotsDir, snapshotName), `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    await fs.writeFile(summaryPath, `${JSON.stringify(output, null, 2)}\n`);
    await context.storageState({ path: storageState });
    console.log(summaryPath);
    console.log(JSON.stringify(output.summary, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
