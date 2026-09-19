import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'amazon_logistics.config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

const EASTERN_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = next && !next.startsWith('--') ? next : true;
    if (next && !next.startsWith('--')) i += 1;
  }
  return args;
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const normalized = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line, index, all) => !(index === all.length - 1 && line === ''));
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function quoteCsvValue(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function stringifyCsv(rows, headers) {
  const lines = [headers.map(quoteCsvValue).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => quoteCsvValue(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function readCsvRows(filePath) {
  return parseCsv(await fs.readFile(filePath, 'utf8'));
}

function resolveTimingCsv(weekFolder, weekNumber) {
  const candidates = [
    path.join(weekFolder, 'dispute', `week${weekNumber}-business-closed-timing.csv`),
    path.join(weekFolder, `week${weekNumber}-business-closed-timing.csv`),
  ];
  return candidates;
}

function findWeekNumber(weekFolder) {
  const match = path.basename(weekFolder).match(/^(\d{4})-wk(\d{1,2})$/i);
  if (!match) {
    throw new Error(`Week folder must look like YYYY-wkNN. Got: ${path.basename(weekFolder)}`);
  }
  return String(Number(match[2])).padStart(2, '0');
}

async function findOneCsv(weekFolder, pattern) {
  const entries = await fs.readdir(weekFolder);
  const match = entries.find((entry) => entry.endsWith('.csv') && entry.includes(pattern));
  if (!match) throw new Error(`Could not find ${pattern} in ${weekFolder}`);
  return path.join(weekFolder, match);
}

function normalizeKey(row, keys) {
  for (const key of keys) {
    if (key in row) return row[key];
  }
  return '';
}

function qualifyingBusinessClosedRows(rtsRows) {
  return rtsRows.filter((row) => {
    return (
      (normalizeKey(row, ['Impact DCR']) || '').trim().toUpperCase() === 'Y' &&
      (normalizeKey(row, ['DA Selected RTS Code']) || '').trim().toUpperCase() === 'BUSINESS CLOSED' &&
      (normalizeKey(row, ['Exemption Reason']) || '').trim() === 'No Exemption Applied'
    );
  });
}

function formatEasternTime(timestampValue) {
  if (timestampValue === null || timestampValue === undefined || timestampValue === '') return '';
  const numeric = Number(timestampValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  return EASTERN_TIME.format(new Date(millis));
}

function summarizeRouteTiming(routeDetails, trackingId) {
  const stops = routeDetails?.rmsRouteDetails?.stops ?? [];
  for (const stop of stops) {
    for (const task of stop.tasks ?? []) {
      const taskTrackingId = task?.domainMap?.scannableId;
      if (taskTrackingId !== trackingId) continue;
      if (task.taskType && task.taskType !== 'DROP_OFF') continue;
      return {
        scheduledDeliveryTime: formatEasternTime(stop.plannedStartTime ?? stop.plannedEndTime),
        businessClosedTime: formatEasternTime(task.actualExecutionTime ?? stop.actualEndTime),
        routeCode: stop.routeCode || routeDetails?.rmsRouteDetails?.routeCode || '',
        rawStop: stop,
        rawTask: task,
      };
    }
  }

  for (const stop of stops) {
    for (const task of stop.tasks ?? []) {
      const taskTrackingId = task?.domainMap?.scannableId;
      if (taskTrackingId !== trackingId) continue;
      return {
        scheduledDeliveryTime: formatEasternTime(stop.plannedStartTime ?? stop.plannedEndTime),
        businessClosedTime: formatEasternTime(task.actualExecutionTime ?? stop.actualEndTime),
        routeCode: stop.routeCode || routeDetails?.rmsRouteDetails?.routeCode || '',
        rawStop: stop,
        rawTask: task,
      };
    }
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const weekFolderArg = args['week-folder'];
  if (!weekFolderArg) {
    throw new Error('Pass --week-folder data/scorecard_data/YYYY-wkNN');
  }

  const weekFolder = path.resolve(repoRoot, weekFolderArg);
  const weekNumber = findWeekNumber(weekFolder);
  const serviceAreaId = args['service-area-id'] || config.executionServiceAreaId;
  if (!serviceAreaId) {
    throw new Error('Execution service area id is required. Set executionServiceAreaId in config or pass --service-area-id.');
  }

  const storageStatePath = path.resolve(repoRoot, config.storageStatePath);
  const headless = parseBool(args.headless, true);
  const waitMs = Number(args['wait-ms'] || 1200);

  const rtsCsvPath = await findOneCsv(weekFolder, 'Quality_RTS');
  const rtsRows = await readCsvRows(rtsCsvPath);
  const targetRows = qualifyingBusinessClosedRows(rtsRows);

  if (targetRows.length === 0) {
    console.log('No DCR-impacting BUSINESS CLOSED rows require timing evidence.');
    return;
  }

  const timingCsvCandidates = resolveTimingCsv(weekFolder, weekNumber);
  let timingCsvPath = timingCsvCandidates[0];
  let timingRows = [];
  for (const candidate of timingCsvCandidates) {
    if (await fileExists(candidate)) {
      timingCsvPath = candidate;
      timingRows = await readCsvRows(candidate);
      break;
    }
  }
  const timingByTrackingId = new Map(
    timingRows.map((row) => [(row.tracking_id || row['Tracking ID'] || '').trim(), row]),
  );
  timingRows = targetRows.map((row) => {
    const trackingId = (row['Tracking ID'] || '').trim();
    return timingByTrackingId.get(trackingId) ?? {
      tracking_id: trackingId,
      scheduled_delivery_time: '',
      business_closed_time: '',
      evidence_source: '',
      notes: '',
    };
  });
  await fs.mkdir(path.dirname(timingCsvPath), { recursive: true });

  const recordsByTrackingId = new Map(
    targetRows.map((row) => {
      const trackingId = (row['Tracking ID'] || '').trim();
      return [trackingId, {
        trackingId,
        driverName: (row['Delivery Associate '] || '').trim(),
        transporterId: (row['Transporter ID'] || '').trim(),
        deliveryDate: (row['Planned Delivery Date'] || '').trim(),
      }];
    }),
  );

  const groupedByDate = new Map();
  for (const record of recordsByTrackingId.values()) {
    const list = groupedByDate.get(record.deliveryDate) ?? [];
    list.push(record);
    groupedByDate.set(record.deliveryDate, list);
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  let capturedCount = 0;
  const failures = [];

  try {
    for (const [deliveryDate, records] of [...groupedByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`Loading Delivery Execution for ${deliveryDate} (${records.length} TBAs)...`);
      const pageUrl = `https://logistics.amazon.com/operations/execution/dv/routes?provider=ALL_DRIVERS&selectedDay=${deliveryDate}&serviceAreaId=${serviceAreaId}&historicalDay=true`;
      const routeDetailsCache = new Map();

      for (const record of records) {
        console.log(`  Capturing ${record.trackingId} for ${record.driverName || record.transporterId}...`);
        let routeSummariesPayload = null;
        const handleResponse = async (response) => {
          const url = response.url();
          if (!url.includes('/operations/execution/api/route-summaries?')) return;
          routeSummariesPayload = JSON.parse(await response.text());
        };
        page.on('response', handleResponse);
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45_000 });
        page.off('response', handleResponse);
        const search = page.getByPlaceholder('Filter by Name or ID (transporter, scan, order, route)');
        await search.waitFor({ state: 'visible', timeout: 60_000 });
        const routeCodeById = new Map(
          (routeSummariesPayload?.rmsRouteSummaries ?? []).map((summary) => [summary.routeId, summary.routeCode]),
        );
        const matchingTransporters = (routeSummariesPayload?.rmsRouteSummaries ?? [])
          .flatMap((summary) => summary.transporters ?? [])
          .filter((transporter) => transporter?.transporterId === record.transporterId);
        const directRouteIds = (routeSummariesPayload?.rmsRouteSummaries ?? [])
          .filter((summary) => (summary.transporters ?? []).some((transporter) => transporter?.transporterId === record.transporterId))
          .map((summary) => summary.routeId)
          .filter(Boolean);
        const associatedRoutes = matchingTransporters
          .flatMap((transporter) => transporter.associatedRoutes ?? [])
          .filter((route) => route?.routeId);
        for (const route of associatedRoutes) {
          if (route.routeCode) routeCodeById.set(route.routeId, route.routeCode);
        }
        const associatedRouteIds = [...new Set(associatedRoutes.map((route) => route.routeId))];
        const isSweeper = associatedRouteIds.length > 1;
        if (isSweeper) {
          console.log(`    Multi-route/sweeper assignment detected: ${associatedRouteIds.map((routeId) => routeCodeById.get(routeId) || routeId).join(', ')}`);
        }
        await search.fill(record.trackingId);
        const queryResponsePromise = page.waitForResponse(
          (response) => response.url().includes('route-summariesByQuery') && response.url().includes(`queryString=${record.trackingId}`),
          { timeout: 20_000 },
        );
        await page.keyboard.press('Enter');
        const queryResponse = await queryResponsePromise;
        const queryPayload = JSON.parse(await queryResponse.text());
        let routeIds = queryPayload.rmsRouteIds ?? [];

        if (routeIds.length === 0 && record.transporterId) {
          await search.fill(record.transporterId);
          const transporterResponsePromise = page.waitForResponse(
            (response) => response.url().includes('route-summariesByQuery') && response.url().includes(`queryString=${record.transporterId}`),
            { timeout: 20_000 },
          );
          await page.keyboard.press('Enter');
          const transporterResponse = await transporterResponsePromise;
          const transporterPayload = JSON.parse(await transporterResponse.text());
          routeIds = transporterPayload.rmsRouteIds ?? [];
        }

        routeIds = [...new Set([...routeIds, ...directRouteIds, ...associatedRouteIds])];

        let timing = null;
        let matchedRouteId = '';
        for (const routeId of routeIds) {
          let routeDetails = routeDetailsCache.get(routeId);
          if (!routeDetails) {
            const detailPage = await context.newPage();
            detailPage.setDefaultTimeout(45_000);
            try {
              await detailPage.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45_000 });
              await detailPage.waitForTimeout(2000);
              let resolveDetail;
              const detailPromise = new Promise((resolve) => {
                resolveDetail = resolve;
              });
              const detailHandler = async (response) => {
                if (!response.url().includes(`/operations/execution/api/route-details/${routeId}`) || response.status() !== 200) return;
                try {
                  resolveDetail(JSON.parse(await response.text()));
                } catch {
                  resolveDetail(null);
                }
              };
              detailPage.on('response', detailHandler);
              await detailPage.locator(`.route-${routeId}`).first().click();
              routeDetails = await Promise.race([
                detailPromise,
                new Promise((resolve) => setTimeout(() => resolve(null), 12_000)),
              ]);
              detailPage.off('response', detailHandler);
              if (routeDetails) routeDetailsCache.set(routeId, routeDetails);
            } catch {
              routeDetails = null;
            } finally {
              await detailPage.close();
            }
          }
          if (!routeDetails) continue;
          timing = summarizeRouteTiming(routeDetails, record.trackingId);
          if (timing?.scheduledDeliveryTime && timing?.businessClosedTime) {
            matchedRouteId = routeId;
            break;
          }
        }

        if (!timing || !timing.scheduledDeliveryTime || !timing.businessClosedTime) {
          const checkedRoutes = routeIds.map((routeId) => routeCodeById.get(routeId) || routeId).join(', ');
          const failure = `${record.trackingId}: no matching route detail with planned and actual timing on ${deliveryDate}${isSweeper ? ` after checking multi-route/sweeper assignment ${checkedRoutes}` : ''}`;
          failures.push(failure);
          const timingRow = timingRows.find((row) => (row.tracking_id || row['Tracking ID'] || '').trim() === record.trackingId);
          if (timingRow) {
            timingRow.evidence_source = `Execution route summaries ${deliveryDate}`;
            timingRow.notes = failure;
          }
          continue;
        }

        const timingRow = timingRows.find((row) => (row.tracking_id || row['Tracking ID'] || '').trim() === record.trackingId);
        if (!timingRow) {
          failures.push(`${record.trackingId}: timing CSV row not found during writeback`);
          continue;
        }

        timingRow.tracking_id = record.trackingId;
        timingRow.scheduled_delivery_time = timing.scheduledDeliveryTime;
        timingRow.business_closed_time = timing.businessClosedTime;
        timingRow.evidence_source = `Execution route details ${timing.routeCode || matchedRouteId} ${deliveryDate}`;
        timingRow.notes = `Captured from Amazon Delivery Execution for ${record.driverName || record.transporterId} on ${deliveryDate}.${isSweeper ? ` Multi-route/sweeper assignment checked across ${routeIds.map((routeId) => routeCodeById.get(routeId) || routeId).join(', ')}.` : ''}`;
        capturedCount += 1;
        console.log(`    ${timing.scheduledDeliveryTime} scheduled, ${timing.businessClosedTime} business closed (${timing.routeCode || matchedRouteId})`);

        if (waitMs > 0) {
          await page.waitForTimeout(waitMs);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const headers = ['tracking_id', 'scheduled_delivery_time', 'business_closed_time', 'evidence_source', 'notes'];
  await fs.writeFile(timingCsvPath, stringifyCsv(timingRows, headers), 'utf8');

  console.log(`Updated ${capturedCount}/${targetRows.length} timing rows in ${path.relative(repoRoot, timingCsvPath)}.`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`- ${failure}`);
  }
}

await main();
