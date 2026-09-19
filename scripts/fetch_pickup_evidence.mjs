import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
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
  const lines = [headers.map((header) => quoteCsvValue(header)).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => quoteCsvValue(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function readCsvRows(filePath) {
  return parseCsv(await fs.readFile(filePath, 'utf8'));
}

function findWeekParts(weekFolder) {
  const match = path.basename(weekFolder).match(/^(\d{4})-wk(\d{1,2})$/i);
  if (!match) {
    throw new Error(`Week folder must look like YYYY-wkNN. Got: ${path.basename(weekFolder)}`);
  }
  return {
    year: Number(match[1]),
    weekNumber: Number(match[2]),
    weekNumPadded: String(Number(match[2])).padStart(2, '0'),
  };
}

async function findOneCsv(weekFolder, pattern) {
  const entries = await fs.readdir(weekFolder);
  const match = entries.find((entry) => entry.endsWith('.csv') && entry.includes(pattern));
  if (!match) throw new Error(`Could not find ${pattern} in ${weekFolder}`);
  return path.join(weekFolder, match);
}

function isoWeekMonday(year, weekNumber) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNumber - 1) * 7);
  return monday;
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function amazonWeekDates(year, weekNumber) {
  const monday = isoWeekMonday(year, weekNumber);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() - 1);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(sunday);
    current.setUTCDate(sunday.getUTCDate() + index);
    return formatDateUtc(current);
  });
}

function toInt(value) {
  const numeric = Number(String(value ?? '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatEasternTime(timestampValue) {
  if (timestampValue === null || timestampValue === undefined || timestampValue === '') return '';
  const numeric = Number(timestampValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  return EASTERN_TIME.format(new Date(millis));
}

function titleizeTokenText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactAddress(address) {
  if (!address) return '';
  return [
    address.address1 || '',
    [address.city || '', address.state || '', address.postalCode || ''].filter(Boolean).join(', '),
  ].filter(Boolean).join(', ');
}

function summarizeRtsRows(rows) {
  if (rows.length === 0) {
    return ['No related RTS rows were found for this driver in the week export.'];
  }

  const lines = [];
  const contactRows = rows.filter((row) => /contact/i.test(`${row.additional_information || ''} ${row.exemption_reason || ''}`));
  if (contactRows.length === 0) {
    lines.push('No explicit contact compliance notes were logged for this driver in week RTS.');
  } else {
    for (const row of contactRows.slice(0, 5)) {
      const detailBits = [
        row.delivery_date,
        row.tracking_id,
        titleizeTokenText(row.rts_code),
        row.impact_dcr ? `Impact DCR ${row.impact_dcr}` : '',
        row.additional_information || '',
        row.exemption_reason || '',
      ].filter(Boolean);
      lines.push(detailBits.join(', '));
    }
  }

  const counts = new Map();
  for (const row of rows) {
    const key = [
      row.rts_code || 'Unknown',
      row.impact_dcr || '',
      row.exemption_reason || '',
      row.additional_information || '',
    ].join('|');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const topPatterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, count]) => {
      const [rtsCode, impactDcr, exemptionReason, additionalInformation] = key.split('|');
      const bits = [titleizeTokenText(rtsCode)];
      if (impactDcr) bits.push(`Impact DCR ${impactDcr}`);
      if (additionalInformation) {
        bits.push(additionalInformation);
      } else if (exemptionReason) {
        bits.push(exemptionReason);
      }
      return `${count}x ${bits.join(' / ')}`;
    });
  if (topPatterns.length > 0) {
    lines.push(`RTS pattern summary: ${topPatterns.join('; ')}.`);
  }
  return lines;
}

function classifyPickupDisputability(target, rows) {
  const stopGroups = new Map();
  for (const row of rows) {
    const key = [row.delivery_date, row.route_id || row.route_code, row.stop_sequence, row.stop_address_id || row.stop_reference].join('|');
    const group = stopGroups.get(key) ?? [];
    group.push(row);
    stopGroups.set(key, group);
  }
  const uniqueStops = [...stopGroups.values()];
  const stopLabels = uniqueStops.map((group) => {
    const row = group[0];
    return `${row.delivery_date || 'unknown-date'} ${row.route_code || row.route_id || 'unknown-route'} stop ${row.stop_sequence || '?'}${row.stop_address_id ? ` (${row.stop_address_id})` : ''}`;
  });
  const exactStopMatch = target.failedStops > 0 && uniqueStops.length === target.failedStops;
  const stationObjectMissing = rows.filter((row) =>
    String(row.stop_sequence || '').trim() === '1'
    && String(row.task_state_context || '').trim().toUpperCase() === 'OBJECT_MISSING');
  const outOfReturnLabels = rows.filter((row) =>
    String(row.task_state_context || '').trim().toUpperCase() === 'OUT_OF_LABELS');
  const customerUnavailable = rows.filter((row) =>
    String(row.task_state_context || '').trim().toUpperCase() === 'CUSTOMER_UNAVAILABLE');
  const attemptedRows = rows.filter((row) =>
    String(row.execution_status || '').trim().toUpperCase() === 'ATTEMPTED');

  const reasoning = [
    `Official PSB summary shows ${target.failedStops} failed stop(s). Live Execution captured ${rows.length} failed pickup task(s) grouped into ${uniqueStops.length} unique physical stop(s).`,
  ];
  if (exactStopMatch) {
    reasoning.push(`The official failed-stop count matches the unique Execution stop count; reconciled stop(s): ${stopLabels.join(', ')}.`);
  } else if (uniqueStops.length > 0) {
    reasoning.push(`The counts do not reconcile: ${uniqueStops.length} Execution stop(s) compete for ${target.failedStops} official failed stop(s). Candidate stops: ${stopLabels.join(', ')}.`);
  }
  let disputableRead = 'No clean PSB dispute angle has been confirmed yet.';
  if (stationObjectMissing.length > 0) {
    disputableRead = 'Most arguable lane: the stop-1 station-origin OBJECT_MISSING event(s) may support an incorrect geo-location or process/data-error narrative after the exact scored stop is reconciled.';
    reasoning.push('The strongest candidate event is a stop-1 station-origin OBJECT_MISSING pickup, which points more to launch/station attribution than a field execution miss.');
  }
  if (attemptedRows.length > 0) {
    reasoning.push(`Execution marked ${attemptedRows.length} captured event(s) as ATTEMPTED, which supports attempted pickup behavior but does not prove which event drove the official PSB score.`);
  }
  if (outOfReturnLabels.length > 0) {
    reasoning.push('Out of return labels is a direct PSB defect in the SOP and is not a clean dispute reason by itself.');
  }
  if (customerUnavailable.length > 0) {
    reasoning.push('Customer unavailable does not map cleanly to the allowed PSB dispute reasons, so it is a weak filing angle unless another guide-backed reason is proven.');
  }
  return { disputableRead, reasoning, uniqueStopCount: uniqueStops.length, stopLabels, exactStopMatch };
}

function buildRelatedRtsRows(rtsRows, targets) {
  const targetIds = new Set(targets.map((target) => target.transporterId));
  const rowsByTransporter = new Map(targets.map((target) => [target.transporterId, []]));
  for (const row of rtsRows) {
    const transporterId = (row['Transporter ID'] || '').trim();
    if (!targetIds.has(transporterId)) continue;
    rowsByTransporter.get(transporterId).push({
      driver_name: (row['Delivery Associate '] || '').trim(),
      transporter_id: transporterId,
      delivery_date: (row['Planned Delivery Date'] || '').trim(),
      tracking_id: (row['Tracking ID'] || '').trim(),
      rts_code: (row['DA Selected RTS Code'] || '').trim(),
      additional_information: (row['Additional Information'] || '').trim(),
      exemption_reason: (row['Exemption Reason'] || '').trim(),
      impact_dcr: (row['Impact DCR'] || '').trim(),
    });
  }
  for (const rows of rowsByTransporter.values()) {
    rows.sort((a, b) =>
      a.delivery_date.localeCompare(b.delivery_date)
      || a.tracking_id.localeCompare(b.tracking_id)
      || a.rts_code.localeCompare(b.rts_code),
    );
  }
  return rowsByTransporter;
}

function normalizeTrackingId(task) {
  return task?.domainMap?.scannableId || task?.scannableId || '';
}

function extractFailedPickupEvidence(routeDetails, target, deliveryDate, routeId, artifactPaths) {
  const rows = [];
  const stops = routeDetails?.rmsRouteDetails?.stops ?? [];
  const routeCode = routeDetails?.rmsRouteDetails?.routeCode || '';
  const transporter = (routeDetails?.rmsRouteDetails?.transporters ?? []).find((item) => (item?.transporterId || '') === target.transporterId) ?? null;
  const addressIndex = new Map(
    (routeDetails?.addresses ?? routeDetails?.rmsRouteDetails?.addresses ?? []).map((address) => [String(address?.addressId || ''), address]),
  );
  for (const stop of stops) {
    for (const task of stop.tasks ?? []) {
      if (task?.taskType !== 'PICK_UP') continue;
      if ((task?.transporterId || '') !== target.transporterId) continue;
      if ((task?.taskState || '') !== 'PICKUP_FAILED') continue;
      const stopAddress = addressIndex.get(String(stop.addressId || task.addressId || '')) || null;
      rows.push({
        week_label: target.weekLabel,
        delivery_date: deliveryDate,
        transporter_id: target.transporterId,
        driver_name: target.driverName,
        route_id: routeId,
        route_code: stop.routeCode || routeCode,
        stop_sequence: String(stop.sequenceNumber ?? ''),
        stop_address_id: stop.addressId || task.addressId || '',
        stop_reference: `${stop.routeCode || routeCode || routeId} stop ${stop.sequenceNumber ?? '?'}${stop.addressId ? ` (${stop.addressId})` : ''}`,
        stop_address_text: compactAddress(stopAddress),
        stop_city: stopAddress?.city || '',
        stop_state: stopAddress?.state || '',
        stop_postal_code: stopAddress?.postalCode || '',
        tracking_id: normalizeTrackingId(task),
        task_id: task.taskId || '',
        reference_id: task.referenceId || '',
        task_state: task.taskState || '',
        task_state_context: task.taskStateContext || '',
        execution_status: task.executionStatus || '',
        planned_time: formatEasternTime(stop.plannedStartTime ?? stop.plannedEndTime),
        actual_time: formatEasternTime(task.actualExecutionTime ?? stop.actualEndTime),
        route_departure_time: formatEasternTime(transporter?.actualRouteDepartureTime),
        planned_rts_time: formatEasternTime(routeDetails?.rmsRouteDetails?.plannedRtsTime),
        execution_latitude: task?.executionGeocode?.latitude ?? '',
        execution_longitude: task?.executionGeocode?.longitude ?? '',
        route_summaries_json_path: artifactPaths.routeSummariesJsonPath || '',
        route_details_json_path: artifactPaths.routeDetailsJsonPath || '',
        route_screenshot_path: artifactPaths.routeScreenshotPath || '',
        evidence_source: `Execution route details ${stop.routeCode || routeCode || routeId} ${deliveryDate}`,
        notes: `Captured from Amazon Delivery Execution for ${target.driverName || target.transporterId} on ${deliveryDate}.`,
      });
    }
  }
  return rows;
}

function buildPickupEvidenceMarkdown(weekNumPadded, targets, rows, failures, csvPath, repoRoot, relatedRtsRowsByTransporter) {
  const rowsByTransporter = new Map();
  for (const row of rows) {
    const transporterId = row.transporter_id || '';
    const list = rowsByTransporter.get(transporterId) ?? [];
    list.push(row);
    rowsByTransporter.set(transporterId, list);
  }

  const failureByTarget = new Map();
  for (const failure of failures) {
    const separatorIndex = failure.indexOf(':');
    const key = separatorIndex >= 0 ? failure.slice(0, separatorIndex).trim() : 'General';
    const list = failureByTarget.get(key) ?? [];
    list.push(failure);
    failureByTarget.set(key, list);
  }

  const lines = [
    `# Week ${Number(weekNumPadded)} Pickup Evidence Bundle`,
    '',
    '**Purpose:** Capture pickup stop evidence pulled from Amazon Delivery Execution for PSB validation lanes.',
    '',
    '## Source Files',
    `- CSV sidecar: \`${path.relative(repoRoot, csvPath)}\``,
    `- Candidate lanes: ${targets.length}`,
    `- Captured stop rows: ${rows.length}`,
    '',
    '## Pickup Evidence',
  ];

  for (const target of targets) {
    const driverRows = rowsByTransporter.get(target.transporterId) ?? [];
    const driverFailures = [
      ...(failureByTarget.get(target.driverName) ?? []),
      ...(failureByTarget.get(target.transporterId) ?? []),
    ];
    const disputeRead = classifyPickupDisputability(target, driverRows);
    lines.push('');
    lines.push(`### ${target.driverName}`);
    lines.push(`- **Transporter ID:** \`${target.transporterId}\``);
    lines.push(`- **PSB failed stops from weekly export:** \`${target.failedStops}\``);
    lines.push(`- **Stop reconciliation:** \`${driverRows.length}\` failed pickup task(s) grouped into \`${disputeRead.uniqueStopCount}\` unique physical stop(s); exact count match: \`${disputeRead.exactStopMatch ? 'yes' : 'no'}\`.`);
    if (driverRows.length === 0) {
      lines.push('- **Captured pickup category details:** No failed pickup stop rows were captured from the live Execution pull in this run.');
    } else {
      lines.push('- **Captured pickup category details:**');
      for (const row of driverRows) {
        const detailBits = [
          row.delivery_date,
          row.route_code,
          row.stop_sequence ? `stop ${row.stop_sequence}` : '',
          row.tracking_id || '',
          row.stop_address_text || '',
        ].filter(Boolean);
        const reasonBits = [
          titleizeTokenText(row.task_state_context || row.task_state || 'Unknown failure'),
          row.planned_time ? `planned ${row.planned_time}` : '',
          row.actual_time ? `actual ${row.actual_time}` : '',
          row.route_departure_time ? `route departed ${row.route_departure_time}` : '',
          row.planned_rts_time ? `planned RTS ${row.planned_rts_time}` : '',
          row.execution_latitude && row.execution_longitude ? `geo ${row.execution_latitude}, ${row.execution_longitude}` : '',
        ].filter(Boolean);
        lines.push(`  - ${detailBits.join(', ')}: ${reasonBits.join('; ')}`);
      }
      const artifactPaths = [...new Set(driverRows.flatMap((row) => [
        row.route_summaries_json_path || '',
        row.route_details_json_path || '',
        row.route_screenshot_path || '',
      ].filter(Boolean)))].sort();
      if (artifactPaths.length > 0) {
        lines.push('- **Portal proof saved:**');
        for (const artifactPath of artifactPaths) {
          lines.push(`  - \`${artifactPath}\``);
        }
      }
    }
    lines.push(`- **Disputability read:** ${disputeRead.disputableRead}`);
    lines.push('- **Interpretation notes:**');
    for (const note of disputeRead.reasoning) {
      lines.push(`  - ${note}`);
    }
    const relatedRtsRows = relatedRtsRowsByTransporter.get(target.transporterId) ?? [];
    lines.push('- **Related contact compliance check:**');
    for (const summaryLine of summarizeRtsRows(relatedRtsRows)) {
      lines.push(`  - ${summaryLine}`);
    }
    if (driverFailures.length > 0) {
      lines.push('- **Fetch notes:**');
      for (const note of driverFailures) {
        lines.push(`  - ${note}`);
      }
    }
  }

  if (failures.length > 0) {
    lines.push('');
    lines.push('## Unresolved Fetch Notes');
    for (const failure of failures) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const weekFolderArg = args['week-folder'];
  if (!weekFolderArg) {
    throw new Error('Pass --week-folder data/scorecard_data/YYYY-wkNN');
  }

  const weekFolder = path.resolve(repoRoot, weekFolderArg);
  const { year, weekNumber, weekNumPadded } = findWeekParts(weekFolder);
  const weekLabel = `${year}-W${weekNumPadded}`;
  const serviceAreaId = args['service-area-id'] || config.executionServiceAreaId;
  if (!serviceAreaId) {
    throw new Error('Execution service area id is required. Set executionServiceAreaId in config or pass --service-area-id.');
  }

  const storageStatePath = path.resolve(repoRoot, config.storageStatePath);
  const headless = parseBool(args.headless, true);
  const waitMs = Number(args['wait-ms'] || 1000);
  const refreshEvidence = parseBool(args['refresh-evidence'], true);

  const psbCsvPath = await findOneCsv(weekFolder, 'Quality_PSB');
  const rtsCsvPath = await findOneCsv(weekFolder, 'Quality_RTS');
  const psbRows = await readCsvRows(psbCsvPath);
  const rtsRows = await readCsvRows(rtsCsvPath);
  const targets = psbRows
    .filter((row) => toInt(row['Failed Stops']) > 0 && (row['Transporter ID'] || '').trim())
    .map((row) => ({
      weekLabel,
      transporterId: (row['Transporter ID'] || '').trim(),
      driverName: (row['Delivery Associate '] || '').trim(),
      failedStops: toInt(row['Failed Stops']),
    }));

  if (targets.length === 0) {
    console.log('No failed pickup rows found in the PSB export.');
    return;
  }

  const disputeDir = path.join(weekFolder, 'dispute');
  await fs.mkdir(disputeDir, { recursive: true });
  const pickupEvidenceDir = path.join(disputeDir, 'evidence', 'pickup');
  await fs.mkdir(pickupEvidenceDir, { recursive: true });
  const evidenceCsvPath = path.join(disputeDir, `week${weekNumPadded}-pickup-evidence.csv`);
  const evidenceMdPath = path.join(disputeDir, `week${weekNumPadded}-pickup-evidence.md`);
  const weekDates = amazonWeekDates(year, weekNumber);
  const relatedRtsRowsByTransporter = buildRelatedRtsRows(rtsRows, targets);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: storageStatePath });
  const evidenceByKey = new Map();
  const failures = [];
  const fetchNotes = [];
  const rowsByTarget = new Map(targets.map((target) => [target.transporterId, 0]));
  let authFailure = '';

  try {
    for (const deliveryDate of weekDates) {
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      console.log(`Loading Delivery Execution for ${deliveryDate}...`);
      const pageUrl = `https://logistics.amazon.com/operations/execution/dv/routes?provider=ALL_DRIVERS&selectedDay=${deliveryDate}&serviceAreaId=${serviceAreaId}&historicalDay=true`;
      let routeSummariesPayload = null;
      const summariesHandler = async (response) => {
        if (response.status() !== 200 || !response.url().includes('/operations/execution/api/route-summaries?') || !response.url().includes(`localDate=${deliveryDate}`)) {
          return;
        }
        try {
          routeSummariesPayload = JSON.parse(await response.text());
        } catch {
          routeSummariesPayload = null;
        }
      };
      page.on('response', summariesHandler);
      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45_000 });
        if (page.url().includes('/ap/signin')) {
          authFailure = `Saved Amazon session redirected to sign-in while loading Delivery Execution for ${deliveryDate}. Re-run amazon:login before fetching pickup evidence.`;
          failures.push(authFailure);
          break;
        }
        await page.waitForTimeout(3000);
        page.off('response', summariesHandler);

        const routeIdsByTransporter = new Map();
        for (const summary of routeSummariesPayload?.rmsRouteSummaries ?? []) {
          for (const transporter of summary.transporters ?? []) {
            const transporterId = transporter?.transporterId || '';
            if (!transporterId) continue;
            const routeIds = routeIdsByTransporter.get(transporterId) ?? [];
            routeIds.push(summary.routeId);
            routeIdsByTransporter.set(transporterId, routeIds);
          }
        }
        let routeSummariesJsonPath = '';
        if (routeSummariesPayload) {
          const routeSummariesFile = path.join(pickupEvidenceDir, `${deliveryDate}-route-summaries.json`);
          await fs.writeFile(routeSummariesFile, `${JSON.stringify(routeSummariesPayload, null, 2)}\n`, 'utf8');
          routeSummariesJsonPath = path.relative(weekFolder, routeSummariesFile);
        }

        for (const target of targets) {
          const routeIds = routeIdsByTransporter.get(target.transporterId) ?? [];
          if (routeIds.length === 0) {
            fetchNotes.push(`${target.driverName || target.transporterId}: no execution route match found in route summaries on ${deliveryDate}`);
            continue;
          }

          for (const routeId of routeIds) {
            let routeDetails = null;
            let routeDetailsJsonPath = '';
            let routeScreenshotPath = '';
            const detailPage = await context.newPage();
            detailPage.setDefaultTimeout(45_000);
            try {
              await detailPage.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45_000 });
              if (detailPage.url().includes('/ap/signin')) {
                authFailure = `Saved Amazon session redirected to sign-in while loading route detail for ${deliveryDate}. Re-run amazon:login before fetching pickup evidence.`;
                failures.push(authFailure);
                await detailPage.close();
                break;
              }
              await detailPage.waitForTimeout(2000);
              let resolveDetail;
              const detailPromise = new Promise((resolve) => {
                resolveDetail = resolve;
              });
              const detailHandler = async (response) => {
                if (!response.url().includes(`/operations/execution/api/route-details/${routeId}`) || response.status() !== 200) {
                  return;
                }
                try {
                  resolveDetail(JSON.parse(await response.text()));
                } catch {
                  resolveDetail(null);
                }
              };
              detailPage.on('response', detailHandler);
              await detailPage.locator(`.route-${routeId}`).first().click();
              const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 12_000));
              routeDetails = await Promise.race([detailPromise, timeoutPromise]);
              detailPage.off('response', detailHandler);
              if (!routeDetails) {
                failures.push(`Route detail lookup timed out for ${routeId} on ${deliveryDate}`);
                await detailPage.close();
                continue;
              }
              const routeCode = routeDetails?.rmsRouteDetails?.routeCode || routeId;
              const artifactStem = `${deliveryDate}-${slugify(routeCode)}-${slugify(target.driverName)}`;
              const routeDetailsFile = path.join(pickupEvidenceDir, `${artifactStem}-route-details.json`);
              await fs.writeFile(routeDetailsFile, `${JSON.stringify(routeDetails, null, 2)}\n`, 'utf8');
              routeDetailsJsonPath = path.relative(weekFolder, routeDetailsFile);
              try {
                await detailPage.waitForTimeout(1200);
                const routeScreenshotFile = path.join(pickupEvidenceDir, `${artifactStem}-route-details.png`);
                await detailPage.screenshot({ path: routeScreenshotFile, fullPage: true });
                routeScreenshotPath = path.relative(weekFolder, routeScreenshotFile);
              } catch {
                fetchNotes.push(`Route detail screenshot capture failed for ${routeCode} on ${deliveryDate}`);
              }
            } catch {
              failures.push(`Route detail lookup failed for ${routeId} on ${deliveryDate}`);
              await detailPage.close();
              continue;
            }
            await detailPage.close();

            for (const row of extractFailedPickupEvidence(routeDetails, target, deliveryDate, routeId, {
              routeSummariesJsonPath,
              routeDetailsJsonPath,
              routeScreenshotPath,
            })) {
              const key = `${row.delivery_date}|${row.transporter_id}|${row.route_id}|${row.task_id}|${row.tracking_id}`;
              evidenceByKey.set(key, row);
            }
          }
          if (authFailure) {
            break;
          }
          if (waitMs > 0) {
            await page.waitForTimeout(waitMs);
          }
        }
      } finally {
        page.off('response', summariesHandler);
        await page.close();
      }
      if (authFailure) {
        break;
      }
    }
  } finally {
    await browser.close();
  }

  const headers = [
    'week_label',
    'delivery_date',
    'transporter_id',
    'driver_name',
    'route_id',
    'route_code',
    'stop_sequence',
    'stop_address_id',
    'stop_reference',
    'stop_address_text',
    'stop_city',
    'stop_state',
    'stop_postal_code',
    'tracking_id',
    'task_id',
    'reference_id',
    'task_state',
    'task_state_context',
    'execution_status',
    'planned_time',
    'actual_time',
    'route_departure_time',
    'planned_rts_time',
    'execution_latitude',
    'execution_longitude',
    'route_summaries_json_path',
    'route_details_json_path',
    'route_screenshot_path',
    'evidence_source',
    'notes',
  ];
  const rows = [...evidenceByKey.values()].sort((a, b) =>
    a.delivery_date.localeCompare(b.delivery_date)
    || a.driver_name.localeCompare(b.driver_name)
    || a.route_code.localeCompare(b.route_code)
    || Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0)
    || a.tracking_id.localeCompare(b.tracking_id),
  );
  for (const row of rows) {
    rowsByTarget.set(row.transporter_id, (rowsByTarget.get(row.transporter_id) ?? 0) + 1);
  }
  for (const target of targets) {
    if (!authFailure && (rowsByTarget.get(target.transporterId) ?? 0) === 0) {
      failures.push(`${target.driverName}: no failed pickup stop rows were found after scanning route details across the week`);
    }
  }
  await fs.writeFile(evidenceCsvPath, stringifyCsv(rows, headers), 'utf8');
  await fs.writeFile(evidenceMdPath, buildPickupEvidenceMarkdown(weekNumPadded, targets, rows, [...fetchNotes, ...failures], evidenceCsvPath, repoRoot, relatedRtsRowsByTransporter), 'utf8');

  console.log(`Wrote ${rows.length} pickup evidence row(s) to ${path.relative(repoRoot, evidenceCsvPath)}.`);
  console.log(`Wrote pickup markdown bundle to ${path.relative(repoRoot, evidenceMdPath)}.`);
  if (refreshEvidence) {
    execFileSync('python3', [
      path.join(__dirname, 'evaluate_week_evidence.py'),
      weekFolder,
      '--force',
      'true',
    ], { cwd: repoRoot, stdio: 'inherit' });
  }
  if (fetchNotes.length > 0) {
    console.log('Fetch notes:');
    for (const note of fetchNotes) console.log(`- ${note}`);
  }
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
  }
}

await main();
