import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'amazon_logistics.config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const easternDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 45_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 12 * 60_000;
const RUN_STATUS_FILENAME = 'run-status.json';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key.startsWith('--')) {
      args[key.slice(2)] = next && !next.startsWith('--') ? next : true;
      if (next && !next.startsWith('--')) i += 1;
    }
  }
  return args;
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function inferWeekFolder(input) {
  if (!input) throw new Error('Pass --week-folder data/scorecard_data/YYYY-wkNN');
  const folder = path.resolve(repoRoot, input);
  const name = path.basename(folder);
  const match = name.match(/^(\d{4})-wk(\d{1,2})$/i);
  if (!match) throw new Error(`Week folder must look like YYYY-wkNN. Got: ${name}`);
  return {
    folder,
    year: Number(match[1]),
    weekNumber: String(Number(match[2])).padStart(2, '0'),
    folderName: name,
    amazonWeekLabel: `${match[1]}-W${String(Number(match[2])).padStart(2, '0')}`
  };
}

async function ensureWeekFolder(folder) {
  await fs.mkdir(folder, { recursive: true });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]/g, '_');
}

function getExpectations(rawConfig) {
  const requiredPatterns = rawConfig.requiredReportPatterns ?? rawConfig.reportPatterns ?? [];
  const optionalPatterns = rawConfig.optionalReportPatterns ?? [];
  const minFileCounts = rawConfig.minFileCounts ?? {};
  return {
    requiredPatterns,
    optionalPatterns,
    minFileCounts,
  };
}

function shouldKeepReport(filename, expectations) {
  const patterns = [
    ...expectations.requiredPatterns,
    ...expectations.optionalPatterns,
    ...Object.keys(expectations.minFileCounts ?? {}),
  ];
  return patterns.some((pattern) => filename.includes(pattern));
}

function buildPatternStatus(files, expectations) {
  const sortedFiles = [...files].sort();
  const requiredMatches = expectations.requiredPatterns.map((pattern) => ({
    pattern,
    matches: sortedFiles.filter((name) => name.includes(pattern)),
  }));
  const optionalMatches = expectations.optionalPatterns.map((pattern) => ({
    pattern,
    matches: sortedFiles.filter((name) => name.includes(pattern)),
  }));
  const missingRequired = requiredMatches.filter((entry) => entry.matches.length === 0).map((entry) => entry.pattern);
  const countFailures = Object.entries(expectations.minFileCounts)
    .map(([pattern, minimum]) => {
      const matches = sortedFiles.filter((name) => name.includes(pattern));
      return {
        pattern,
        minimum,
        actual: matches.length,
        matches,
      };
    })
    .filter((entry) => entry.actual < entry.minimum);

  return {
    files: sortedFiles,
    requiredMatches,
    optionalMatches,
    missingRequired,
    countFailures,
  };
}

async function summarizeFolder(downloadDir, expectations) {
  const files = await fs.readdir(downloadDir);
  return buildPatternStatus(files, expectations);
}

function printStatus(status, sourceStatus = null) {
  console.log('\nValidation status');
  for (const entry of status.requiredMatches) {
    const mark = entry.matches.length > 0 ? '✓' : '✗';
    console.log(`  ${mark} required: ${entry.pattern}`);
    for (const match of entry.matches) console.log(`      - ${match}`);
  }

  for (const entry of status.countFailures) {
    console.log(`  ✗ required count: ${entry.pattern} (${entry.actual}/${entry.minimum})`);
    for (const match of entry.matches) console.log(`      - ${match}`);
  }

  if (status.optionalMatches.length > 0) {
    console.log('\nOptional report matches');
    for (const entry of status.optionalMatches) {
      const summary = entry.matches.length > 0 ? `${entry.matches.length} file(s)` : 'not present';
      console.log(`  - ${entry.pattern}: ${summary}`);
      for (const match of entry.matches) console.log(`      - ${match}`);
    }
  }

  if (status.missingRequired.length === 0 && status.countFailures.length === 0) {
    console.log('\nAll required analysis files are present.');
  } else {
    console.log('\nStill missing required analysis files:');
    for (const pattern of status.missingRequired) console.log(`  - ${pattern}`);
    for (const entry of status.countFailures) {
      console.log(`  - ${entry.pattern}: need at least ${entry.minimum}, found ${entry.actual}`);
    }
  }

  if (sourceStatus) {
    console.log('\nAmazon source feed status');
    if (sourceStatus.unavailable) {
      console.log('  ! source listing unavailable for this run');
      for (const entry of sourceStatus.failedReports ?? []) {
        console.log(`      - ${entry.report}: ${entry.error}`);
      }
      return;
    }
    for (const entry of sourceStatus.requiredMatches) {
      const mark = entry.matches.length > 0 ? '✓' : '✗';
      console.log(`  ${mark} source required: ${entry.pattern}`);
      for (const match of entry.matches) console.log(`      - ${match}`);
    }
    for (const entry of sourceStatus.countFailures) {
      console.log(`  ✗ source required count: ${entry.pattern} (${entry.actual}/${entry.minimum})`);
      for (const match of entry.matches) console.log(`      - ${match}`);
    }

    if (sourceStatus.missingRequired.length === 0 && sourceStatus.countFailures.length === 0) {
      console.log('\nAmazon source feed appears complete for the required patterns.');
    } else {
      console.log('\nAmazon source feed is incomplete for this week:');
      for (const pattern of sourceStatus.missingRequired) console.log(`  - ${pattern}`);
      for (const entry of sourceStatus.countFailures) {
        console.log(`  - ${entry.pattern}: source only has ${entry.actual}/${entry.minimum}`);
      }
    }
  }
}

async function writeManifest(downloadDir, status, automation = null, sourceStatus = null) {
  const manifestPath = path.join(downloadDir, 'download-manifest.json');
  const manifest = {
    generatedAt: new Date().toISOString(),
    fileCount: status.files.length,
    files: status.files,
    requiredMatches: status.requiredMatches,
    optionalMatches: status.optionalMatches,
    missingRequired: status.missingRequired,
    countFailures: status.countFailures,
    sourceStatus,
    automation,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

async function sha1File(filePath) {
  const data = await fs.readFile(filePath);
  return createHash('sha1').update(data).digest('hex');
}

async function writeSnapshotMetadata(downloadDir, status, expectations, sourceStatus = null) {
  const snapshotPath = path.join(downloadDir, 'snapshot-metadata.json');
  const sourceFiles = status.files
    .filter((name) => shouldKeepReport(name, expectations))
    .sort();

  const fileEntries = [];
  for (const name of sourceFiles) {
    const fullPath = path.join(downloadDir, name);
    const stats = await fs.stat(fullPath);
    fileEntries.push({
      name,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sha1: await sha1File(fullPath),
    });
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceFileCount: fileEntries.length,
    sourceFiles: fileEntries,
    requiredPatterns: expectations.requiredPatterns,
    optionalPatterns: expectations.optionalPatterns,
    minFileCounts: expectations.minFileCounts,
    missingRequired: status.missingRequired,
    countFailures: status.countFailures,
    sourceStatus,
  };

  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshotPath;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(Boolean))].sort();
}

function getRunStatusPath(downloadDir) {
  return path.join(downloadDir, RUN_STATUS_FILENAME);
}

async function readRunStatus(downloadDir) {
  const statusPath = getRunStatusPath(downloadDir);
  try {
    const raw = await fs.readFile(statusPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readManifest(downloadDir) {
  const manifestPath = path.join(downloadDir, 'download-manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function createRunStatusState(week, options, previous = null) {
  const now = new Date().toISOString();
  return {
    version: 1,
    weekFolder: week.folderName,
    amazonWeekLabel: week.amazonWeekLabel,
    status: 'in_progress',
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    lastSuccessfulRunAt: previous?.lastSuccessfulRunAt ?? null,
    attemptCount: (previous?.attemptCount ?? 0) + 1,
    currentPhase: 'initializing',
    currentItem: null,
    options,
    completedApiReports: uniqueStrings(previous?.completedApiReports),
    skippedApiReports: uniqueStrings(previous?.skippedApiReports),
    completedSupplementarySources: uniqueStrings(previous?.completedSupplementarySources),
    completedSupplementaryFiles: uniqueStrings(previous?.completedSupplementaryFiles),
    skippedExistingFiles: uniqueStrings(previous?.skippedExistingFiles),
    failures: Array.isArray(previous?.failures) ? previous.failures : [],
    manifestPath: previous?.manifestPath ?? null,
    validationPassed: previous?.validationPassed ?? false,
    missingRequired: previous?.missingRequired ?? [],
    countFailures: previous?.countFailures ?? [],
    upstreamMissingRequired: previous?.upstreamMissingRequired ?? [],
    upstreamCountFailures: previous?.upstreamCountFailures ?? [],
    lastError: null,
  };
}

function createRunStatusTracker(downloadDir, initialState) {
  const statusPath = getRunStatusPath(downloadDir);
  let state = initialState;

  const persist = async () => {
    state = { ...state, updatedAt: new Date().toISOString() };
    await fs.writeFile(statusPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  };

  const clearFailure = (scope, key) => {
    state = {
      ...state,
      failures: (state.failures ?? []).filter((entry) => !(entry.scope === scope && entry.key === key)),
    };
  };

  return {
    getState() {
      return state;
    },
    async persist() {
      await persist();
    },
    async setPhase(phase, currentItem = null, extra = {}) {
      state = {
        ...state,
        currentPhase: phase,
        currentItem,
        ...extra,
      };
      await persist();
    },
    async noteApiReport(reportKey, filename, mode = 'generated') {
      clearFailure('api', reportKey);
      state = {
        ...state,
        completedApiReports: uniqueStrings([...(state.completedApiReports ?? []), reportKey]),
        skippedApiReports: mode === 'existing'
          ? uniqueStrings([...(state.skippedApiReports ?? []), reportKey])
          : uniqueStrings((state.skippedApiReports ?? []).filter((entry) => entry !== reportKey)),
        skippedExistingFiles: mode === 'existing'
          ? uniqueStrings([...(state.skippedExistingFiles ?? []), filename])
          : uniqueStrings((state.skippedExistingFiles ?? []).filter((entry) => entry !== filename)),
      };
      await persist();
    },
    async noteSupplementarySource(report) {
      clearFailure('supplementary', report);
      state = {
        ...state,
        completedSupplementarySources: uniqueStrings([...(state.completedSupplementarySources ?? []), report]),
      };
      await persist();
    },
    async noteSupplementaryFile(filename, mode = 'downloaded') {
      state = {
        ...state,
        completedSupplementaryFiles: uniqueStrings([...(state.completedSupplementaryFiles ?? []), filename]),
        skippedExistingFiles: mode === 'existing'
          ? uniqueStrings([...(state.skippedExistingFiles ?? []), filename])
          : uniqueStrings((state.skippedExistingFiles ?? []).filter((entry) => entry !== filename)),
      };
      await persist();
    },
    async noteFailure(scope, key, error) {
      state = {
        ...state,
        failures: [
          ...(state.failures ?? []).filter((entry) => !(entry.scope === scope && entry.key === key)),
          { scope, key, error, at: new Date().toISOString() },
        ],
        lastError: error,
      };
      await persist();
    },
    async finalize(status, extra = {}) {
      state = {
        ...state,
        status,
        currentPhase: status === 'completed' ? 'completed' : state.currentPhase,
        currentItem: status === 'completed' ? null : state.currentItem,
        lastSuccessfulRunAt: status === 'completed' ? new Date().toISOString() : state.lastSuccessfulRunAt,
        ...extra,
      };
      await persist();
    },
  };
}

function getRetryFailuresOnlyPlan(previous = null) {
  const failures = Array.isArray(previous?.failures) ? previous.failures : [];
  const apiReports = uniqueStrings(failures.filter((entry) => entry.scope === 'api').map((entry) => entry.key));
  const supplementarySources = uniqueStrings(failures.filter((entry) => entry.scope === 'supplementary').map((entry) => entry.key));

  if (previous?.status !== 'completed') {
    if (previous?.currentPhase === 'automated_exports' && previous?.currentItem) {
      apiReports.push(previous.currentItem);
    }
    if (previous?.currentPhase === 'supplementary_exports' && previous?.currentItem) {
      supplementarySources.push(previous.currentItem);
    }
  }

  return {
    apiReports: uniqueStrings(apiReports),
    supplementarySources: uniqueStrings(supplementarySources),
  };
}

function targetedModeLabel(retryPlan) {
  if (!retryPlan) return null;
  const hasApiTargets = (retryPlan.apiReports ?? []).length > 0;
  const hasSupplementaryTargets = (retryPlan.supplementarySources ?? []).length > 0;
  if (!hasApiTargets && hasSupplementaryTargets) return 'Supplementary-only';
  return 'Targeted';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isoWeekMonday(year, week) {
  const date = new Date(Date.UTC(year, 0, 4 + (week - 1) * 7));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function getAmazonWeekRange(week) {
  const monday = isoWeekMonday(week.year, Number(week.weekNumber));
  const start = addUtcDays(monday, -1);
  const end = addUtcDays(monday, 5);
  return {
    fromDaily: formatUtcDate(start),
    toDaily: formatUtcDate(end),
  };
}

function csvCell(value) {
  const normalized = value === null || value === undefined ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}

async function writeCsvReport(downloadDir, filename, headers, rows) {
  const target = path.join(downloadDir, normalizeFilename(filename));
  await fs.writeFile(target, toCsv(headers, rows), 'utf8');
  return target;
}

async function downloadFileToPath(requestContext, url, targetPath, timeoutMs) {
  const response = await requestContext.get(url, { timeout: timeoutMs });
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status()}): ${body.slice(0, 300)}`);
  }
  const buffer = await response.body();
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

function trimFixed(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function fixed(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toFixed(digits);
}

function integer(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return String(Math.round(num));
}

function percent(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return `${(num * 100).toFixed(digits)}%`;
}

function getByKey(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return '';
}

function formatEasternTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(easternDateTime.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatAmazonWeekNoW(row) {
  const year = getByKey(row, 'year');
  const week = getByKey(row, 'week', 'week_no');
  if (!year || week === '') return '';
  return `${year}-${pad2(week)}`;
}

function indexBy(rows, keyFn) {
  return new Map(rows.map((row) => [keyFn(row), row]));
}

function humanizeFeedback(code) {
  if (!code) return '';
  const normalized = String(code).replace(/^sonorus_/, '');
  const custom = {
    package_delivered_wrong_unit: 'Delivered to wrong unit number',
    driver_did_not_follow_delivery_instructions: 'Package not delivered according to instruction notes I provided',
    package_left_in_appropriate_location: 'Package not left in appropriate location',
    package_delivered_neighboring_address: 'Delivered to neighboring address',
    package_delivered_wrong_street_address: 'Delivered to wrong street address',
    received_someone_elses_package: "Received someone else's package",
    driver_threw_package: 'Driver threw package',
    driver_dropped_package: 'Driver dropped package',
  };
  if (custom[normalized]) return custom[normalized];
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseTableRows(json, preferredKey = null) {
  const tableData = json?.tableData ?? {};
  const key = preferredKey ?? Object.keys(tableData)[0];
  if (!key || !tableData[key]) return [];
  return (tableData[key].rows ?? []).map((row) => JSON.parse(row));
}

async function fetchDataSet(page, rawConfig, query, preferredKey = null) {
  const apiBaseUrl = rawConfig.performanceApiBaseUrl ?? 'https://logistics.amazon.com/performance/api/v1';
  const url = `${apiBaseUrl}/getData?${new URLSearchParams(query).toString()}`;
  const requestTimeoutMs = parseNumber(rawConfig.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const response = await page.request.get(url, { timeout: requestTimeoutMs });
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET ${query.dataSetId} failed (${response.status()}): ${body.slice(0, 300)}`);
  }
  const json = await response.json();
  return parseTableRows(json, preferredKey);
}

function getManualStartUrl(rawConfig, week) {
  if (!rawConfig.companyId || !rawConfig.stationCode) return rawConfig.baseUrl;
  const params = new URLSearchParams({
    pageId: 'dsp_supp_reports',
    companyId: rawConfig.companyId,
    station: rawConfig.stationCode,
    timeFrame: 'Weekly',
    to: week.amazonWeekLabel,
  });
  return `${rawConfig.performancePortalUrl ?? 'https://logistics.amazon.com/performance'}?${params.toString()}`;
}

async function runAutomatedExports(page, rawConfig, week, downloadDir, expectations, tracker = null, retryPlan = null) {
  if (!rawConfig.stationCode || !rawConfig.dspCode || !rawConfig.companyId) {
    return {
      attempted: false,
      reason: 'Missing stationCode/dspCode/companyId in config.',
      generatedFiles: [],
      failures: [],
    };
  }

  const { fromDaily, toDaily } = getAmazonWeekRange(week);
  const commonWeekly = {
    dsp: rawConfig.dspCode,
    station: rawConfig.stationCode,
    timeFrame: 'Weekly',
    from: week.amazonWeekLabel,
    to: week.amazonWeekLabel,
  };
  const commonDaily = {
    dsp: rawConfig.dspCode,
    station: rawConfig.stationCode,
    timeFrame: 'Daily',
    from: fromDaily,
    to: toDaily,
  };

  const cache = new Map();
  const fetchCached = async (name, query, preferredKey = null) => {
    if (!cache.has(name)) cache.set(name, fetchDataSet(page, rawConfig, query, preferredKey));
    return cache.get(name);
  };

  const generatedFiles = [];
  const failures = [];
  const downloadedSupplementaryFiles = [];
  const skippedExistingFiles = [];
  const skippedByRetryFilter = [];
  const modeLabel = targetedModeLabel(retryPlan);
  const sourceFilesByReport = {};
  const sourceListingFailures = [];
  const sourceListingSuccessReports = [];
  const requestTimeoutMs = parseNumber(rawConfig.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const fileNames = {
    overview: `DSP_Overview_Dashboard_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    safety: `Safety_Dashboard_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    dcr: `Quality_DCR_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    dsb: `Quality_DSB_DNR_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    pod: `Quality_POD_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    psb: `Quality_PSB_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    cdf: `Quality_CDF_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    rts: `Quality_RTS_${rawConfig.dspCode}_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    negativeCdf: `DSP_Customer_Delivery_Feedback_negative_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
    concessions: `DSP_Delivery_Concessions_${rawConfig.stationCode}_${week.amazonWeekLabel}.csv`,
  };
  const sourceExpectations = {
    requiredPatterns: expectations.requiredPatterns.filter(
      (pattern) => !Object.values(fileNames).some((filename) => filename.includes(pattern))
    ),
    optionalPatterns: expectations.optionalPatterns,
    minFileCounts: expectations.minFileCounts,
  };

  const specs = [
    {
      key: 'overview',
      headers: ['Week', 'Delivery Associate ', 'Transporter ID', 'Overall Standing', 'Overall Score', 'FICO Metric', 'FICO Tier', 'FICO Score', 'Speeding Event Rate (per trip)', 'Speeding Event Rate Tier', 'Speeding Event Rate Score', 'Seatbelt-Off Rate (per trip)', 'Seatbelt-Off Rate Tier', 'Seatbelt-Off Rate Score', 'Distractions Rate (per trip)', 'Distractions Rate Tier', 'Distractions Rate Score', 'Sign/ Signal Violations Rate (per trip)', 'Sign/ Signal Violations Rate Tier', 'Sign/ Signal Violations Rate Score', 'Following Distance Rate (per trip)', 'Following Distance Rate Tier', 'Following Distance Rate Score', 'CDF DPMO', 'CDF DPMO Tier', 'CDF DPMO Score', 'CED', 'CED Tier', 'CED Score', 'DCR', 'DCR Tier', 'DCR Score', 'DSB', 'DSB DPMO Tier', 'DSB DPMO Score', 'POD', 'POD Tier', 'POD Score', 'PSB', 'PSB Tier', 'PSB Score', 'Packages Delivered', 'FICO Metric Weight Applied', 'Speeding Event Rate Weight Applied', 'Seatbelt-Off Rate Weight Applied', 'Distractions Rate Weight Applied', 'Sign/ Signal Violations Rate Weight Applied', 'Following Distance Rate Weight Applied', 'CDF DPMO Weight Applied', 'CED Weight Applied', 'DCR Weight Applied', 'DSB DPMO Weight Applied', 'POD Weight Applied', 'PSB Weight Applied'],
      rows: async () => {
        const source = await fetchCached('overview', {
          dataSetId: 'da_dsp_station_weekly_performance',
          ...commonWeekly,
          dspId: rawConfig.companyId,
          program: rawConfig.program ?? 'AMZL',
        });
        return source.map((row) => [
          row.data_date ?? '',
          row.da_name ?? '',
          row.transporter_id ?? '',
          row.da_overall_tier ?? '',
          trimFixed(row.da_overall_score, 2),
          '',
          '',
          '',
          trimFixed(row.speeding_rate, 1),
          row.speeding_tier ?? '',
          trimFixed(row.speeding_score, 2),
          trimFixed(row.seatbelt_rate, 1),
          row.seatbelt_tier ?? '',
          trimFixed(row.seatbelt_score, 2),
          trimFixed(row.distractions_rate, 1),
          row.distractions_tier ?? '',
          trimFixed(row.distractions_score, 2),
          trimFixed(row.sign_signal_violations_rate, 1),
          row.sign_signal_violations_rate_tier ?? '',
          trimFixed(row.sign_signal_violations_rate_score, 2),
          trimFixed(row.following_distance_rate, 1),
          row.following_distance_tier ?? '',
          trimFixed(row.following_distance_score, 2),
          integer(row.cdf_metric_dpmo),
          row.cdf_dpmo_tier ?? '',
          trimFixed(row.cdf_dpmo_score, 2),
          integer(row.escalations_count),
          row.ced_tier ?? '',
          trimFixed(row.ced_score, 2),
          percent(row.dcr_metric, 1),
          row.dcr_tier ?? '',
          trimFixed(row.dcr_score, 2),
          integer(row.dsb_count),
          row.dsb_tier ?? '',
          trimFixed(row.dsb_score, 2),
          percent(row.pod_metric, 1),
          row.pod_tier ?? '',
          trimFixed(row.pod_score, 2),
          '',
          '',
          '',
          integer(row.delivered),
          trimFixed(row.fico_raw_adjusted_weight, 1),
          trimFixed(row.speeding_rate_adjusted_weight, 1),
          trimFixed(row.seatbelt_rate_adjusted_weight, 1),
          trimFixed(row.distractions_rate_adjusted_weight, 1),
          trimFixed(row.sign_signal_violations_rate_adjusted_weight, 1),
          trimFixed(row.following_distance_rate_adjusted_weight, 1),
          trimFixed(row.cdf_metric_dpmo_adjusted_weight, 1),
          trimFixed(row.escalations_count_adjusted_weight, 1),
          trimFixed(row.dcr_metric_adjusted_weight, 1),
          trimFixed(row.dsb_metric_dpmo_adjusted_weight, 1),
          trimFixed(row.pod_metric_adjusted_weight, 1),
          trimFixed(row.psb_metric_adjusted_weight, 1),
        ]);
      },
    },
    {
      key: 'safety',
      headers: ['Date', 'Delivery Associate ', 'Transporter ID', 'Event ID', 'Date Time (PDT/PST)', 'VIN', 'Program Impact', 'Metric Type', 'Metric Subtype', 'Source', 'Video Link', 'Review Details'],
      rows: async () => {
        const source = await fetchCached('safety', {
          dataSetId: 'da_dsp_station_daily_safety_oss_events_intraday',
          ...commonDaily,
          dspId: rawConfig.companyId,
        });
        return source.map((row) => [
          String(row.event_start_time_pst ?? '').slice(0, 10),
          row.da_name ?? '',
          row.transporter_id ?? '',
          row.event_id ?? '',
          row.event_start_time_pst ?? '',
          row.vehicle_id ?? '',
          row.program_impact ?? '',
          row.dashboard_metric_type ?? '',
          row.dashboard_metric_subtype ?? '',
          row.dashboard_source ?? '',
          row.video_url ?? '',
          row.dashboard_review_details ?? '',
        ]);
      },
    },
    {
      key: 'dcr',
      headers: ['Week', 'Delivery Associate ', 'Transporter ID', 'DCR', 'Packages Delivered', 'Packages Dispatched', 'Packages Returned To Station', 'Packages Returned to Station - DA Controllable', 'RTS All Exempted', 'RTS Business Closed', 'RTS Customer Unavailable', 'RTS No Secure Location', 'RTS Other', 'RTS Out of Drive Time', 'RTS Unable To Access', 'RTS Unable To Locate', 'RTS Unsafe Due to Dog', 'RTS Bad Weather', 'RTS Locker Issue', 'RTS Missing or Incorrect Access Code', 'RTS OTP Not Available'],
      rows: async () => {
        const [supplemental, weeklyRts] = await Promise.all([
          fetchCached('supplementalQuality', {
            dataSetId: 'da_dsp_station_weekly_supplemental_quality',
            ...commonWeekly,
          }),
          fetchCached('weeklyRts', {
            dataSetId: 'da_dsp_weekly_rts',
            ...commonWeekly,
          }),
        ]);
        const rtsByProvider = indexBy(weeklyRts, (row) => row.provider_id);
        return supplemental.map((row) => {
          const rts = rtsByProvider.get(row.provider_id) ?? {};
          return [
            formatAmazonWeekNoW(row),
            row.da_name ?? '',
            row.transporter_id ?? '',
            percent(row.delivery_success, 2),
            integer(row.delivered),
            integer(row.dispatched),
            integer(row.return_to_station_all),
            integer(getByKey(rts, 'rts_all_controllable')),
            integer(getByKey(rts, 'rts_all_exempted')),
            integer(getByKey(rts, 'rts_business_closed', 'return_to_station_bc', row.return_to_station_bc)),
            integer(getByKey(rts, 'rts_customer_unavailable', 'return_to_station_cu', row.return_to_station_cu)),
            integer(getByKey(rts, 'rts_no_secure_location', 'return_to_station_nsl', row.return_to_station_nsl)),
            integer(getByKey(rts, 'rts_other_category', 'rts_other', row.rts_other)),
            integer(getByKey(rts, 'rts_oodt', 'return_to_station_oodt', row.return_to_station_oodt)),
            integer(getByKey(rts, 'rts_inaccessible_delivery_location', 'return_to_station_uta', row.return_to_station_uta)),
            integer(getByKey(rts, 'rts_address_not_found', 'return_to_station_utl', row.return_to_station_utl)),
            integer(getByKey(rts, 'rts_unsafe_due_to_dog', 'return_to_station_dog', row.return_to_station_dog)),
            integer(getByKey(rts, 'rts_bad_weather')),
            integer(getByKey(rts, 'rts_locker_issue')),
            integer(getByKey(rts, 'rts_missing_or_incorrect_access_code')),
            integer(getByKey(rts, 'rts_otp_not_available')),
          ];
        });
      },
    },
    {
      key: 'dsb',
      headers: ['Week', 'Delivery Associate ', 'Transporter ID', 'DSB Count', 'DSB DPMO', 'Attended Delivery Count', 'Unattended Delivery Count', 'Simultaneous Deliveries', 'Delivered > 50 m', 'Incorrect Scan Usage - Attended Delivery', 'Incorrect Scan Usage - Unattended Delivery', 'No POD on Delivery', 'Scanned - Not Delivered - Not Returned'],
      rows: async () => {
        const source = await fetchCached('weeklyDsbDnr', {
          dataSetId: 'da_dsp_station_weekly_dsb_dnr',
          ...commonWeekly,
        });
        return source.map((row) => [
          formatAmazonWeekNoW(row),
          row.da_name ?? '',
          row.transporter_id ?? '',
          integer(row.dsb_count),
          integer(row.dsb_dpmo),
          integer(row.attended_count),
          integer(row.unattended_count),
          integer(row.simultaneous_del_bucket_count),
          integer(row.del_greater_50m_dist_count),
          integer(row.incorrect_scan_attended_delivery_count),
          integer(row.incorrect_scan_unattended_delivery_count),
          integer(row.no_pod_bucket_count),
          integer(row.dac_loss_count),
        ]);
      },
    },
    {
      key: 'pod',
      headers: ['Week', 'Delivery Associate ', 'Transporter ID', 'SWC - Photo on Delivery', 'POD Success', 'POD Opportunities'],
      rows: async () => {
        const source = await fetchCached('supplementalQuality', {
          dataSetId: 'da_dsp_station_weekly_supplemental_quality',
          ...commonWeekly,
        });
        return source.map((row) => [
          formatAmazonWeekNoW(row),
          row.da_name ?? '',
          row.transporter_id ?? '',
          fixed(row.pod_success_rate, 2),
          integer(row.pod_success),
          integer(row.pod_opportunity),
        ]);
      },
    },
    {
      key: 'psb',
      headers: ['Week', 'Delivery Associate ', 'Transporter ID', 'PSB', 'Successful Stops', 'Failed Stops'],
      rows: async () => {
        const source = await fetchCached('weeklyPsb', {
          dataSetId: 'da_dsp_weekly_psb',
          ...commonWeekly,
        });
        return source.map((row) => [
          row.data_date ?? '',
          row.da_name ?? '',
          row.transporter_id ?? '',
          fixed(row.psb_metric, 2),
          integer(row.successful_stops),
          integer(row.failed_stops),
        ]);
      },
    },
    {
      key: 'cdf',
      headers: ['Delivery Associate ', 'Transporter ID', 'CDF DPMO', 'CDF DPMO Tier', 'CDF DPMO Score', 'Negative Feedback Count'],
      rows: async () => {
        const [overviewRows, weeklyCdf] = await Promise.all([
          fetchCached('overview', {
            dataSetId: 'da_dsp_station_weekly_performance',
            ...commonWeekly,
            dspId: rawConfig.companyId,
            program: rawConfig.program ?? 'AMZL',
          }),
          fetchCached('weeklyCdf', {
            dataSetId: 'da_dsp_weekly_cdf',
            ...commonWeekly,
          }),
        ]);
        const cdfByProvider = indexBy(weeklyCdf, (row) => row.provider_id);
        return overviewRows.map((row) => {
          const cdf = cdfByProvider.get(row.provider_id) ?? {};
          return [
            row.da_name ?? '',
            row.transporter_id ?? '',
            integer(row.cdf_metric_dpmo),
            row.cdf_dpmo_tier ?? '',
            trimFixed(row.cdf_dpmo_score, 2),
            integer(getByKey(cdf, 'negative_response_cnt')),
          ];
        });
      },
    },
    {
      key: 'rts',
      headers: ['Delivery Associate ', 'Tracking ID', 'Transporter ID', 'Impact DCR', 'DA Selected RTS Code', 'Additional Information', 'Exemption Reason', 'Planned Delivery Date', 'Service Area'],
      rows: async () => {
        const source = await fetchCached('weeklyRtsDeepDive', {
          dataSetId: 'da_dsp_weekly_rts_deep_dive',
          ...commonWeekly,
        });
        return source.map((row) => [
          row.da_name ?? '',
          row.tracking_id ?? '',
          row.transporter_id ?? '',
          row.impacting_dcr ?? '',
          row.rts_reason_code ?? '',
          row.weekly_coaching ?? '',
          row.weekly_exemption_reason ?? '',
          row.delivery_planned_date ?? '',
          row.station_code ?? '',
        ]);
      },
    },
    {
      key: 'negativeCdf',
      headers: ['Delivery Group ID', 'Delivery Associate', 'Delivery Associate Name', 'DA Mishandled Package', 'DA was Unprofessional', 'DA did not follow my delivery instructions', 'Delivered to Wrong Address', 'Never Received Delivery', 'Received Wrong Item', 'Feedback Details', 'Tracking ID', 'Delivery Date'],
      rows: async () => {
        const source = await fetchCached('weeklyCdfDeepDive', {
          dataSetId: 'da_dsp_weekly_cdf_deep_dive',
          ...commonWeekly,
        });
        return source
          .filter((row) => Number(row.negative_feedback_flag) === 1)
          .map((row) => [
            row.delivery_id ?? '',
            row.transporter_id ?? '',
            row.da_name ?? '',
            integer(row.driver_mishandled_package),
            integer(row.driver_was_unprofessional),
            integer(row.not_delivered_to_preferred_location),
            integer(row.delivered_to_wrong_address),
            integer(row.never_received_delivery),
            integer(row.received_wrong_item),
            humanizeFeedback(getByKey(row, 'level_3_negative_feedback', 'level_2_negative_feedback')),
            row.tracking_id ?? '',
            row.delivery_time ?? '',
          ]);
      },
    },
    {
      key: 'concessions',
      headers: ['Delivery Associate Name', 'Delivery Associate', 'Impacts DSB', 'Delivery Type', 'Simultaneous Deliveries', 'Delivered > 50 m', 'Incorrect Scan Usage - Attended Delivery', 'Incorrect Scan Usage - Unattended Delivery', 'No POD on Delivery', 'Scanned - Not Delivered - Not Returned', 'Tracking ID', 'Pickup Date', 'Delivery Attempt Date', 'Delivery Date', 'Concession Date', 'Service Area', 'DSP'],
      rows: async () => {
        const source = await fetchCached('dailyConcessions', {
          dataSetId: 'da_dsp_station_daily_dsb_dnr_tba',
          ...commonDaily,
        });
        return source.map((row) => [
          row.da_name ?? '',
          row.transporter_id ?? '',
          integer(row.dsb_flag),
          row.delivery_type ?? '',
          integer(row.simultaneous_del_bucket_flag),
          integer(row.del_greater_50m_dist_flag),
          integer(row.incorrect_scan_attended_delivery_flag),
          integer(row.incorrect_scan_unattended_delivery_flag),
          integer(row.no_pod_bucket_flag),
          integer(row.dac_loss_flag),
          row.tracking_id ?? '',
          '',
          '',
          formatEasternTimestamp(row.delivery_datetime_iso),
          formatEasternTimestamp(row.concession_creationdatetime_iniso),
          row.station_code ?? '',
          row.dsp_code ?? '',
        ]);
      },
    },
  ];

  for (const spec of specs) {
    const targetName = fileNames[spec.key];
    const targetPath = path.join(downloadDir, targetName);
    try {
      if (retryPlan?.apiReports && !retryPlan.apiReports.includes(spec.key)) {
        skippedByRetryFilter.push(spec.key);
        console.log(`${modeLabel ?? 'Targeted'} mode: skipped API report ${spec.key}`);
        continue;
      }
      await tracker?.setPhase('automated_exports', spec.key);
      if (await fileExists(targetPath)) {
        generatedFiles.push(targetName);
        skippedExistingFiles.push(targetName);
        await tracker?.noteApiReport(spec.key, targetName, 'existing');
        console.log(`Skipped existing API report: ${targetName}`);
        continue;
      }

      logStep(`Generating ${spec.key}...`);
      const rows = await spec.rows();
      const target = await writeCsvReport(downloadDir, targetName, spec.headers, rows);
      generatedFiles.push(path.basename(target));
      await tracker?.noteApiReport(spec.key, path.basename(target));
      console.log(`Generated API report: ${path.basename(target)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ report: spec.key, error: message });
      await tracker?.noteFailure('api', spec.key, message);
      console.log(`API export failed for ${spec.key}: ${message}`);
    }
  }

  const supplementarySources = [
    {
      report: 'supplementaryReports',
      query: {
        dataSetId: 'dsp_station_weekly_supp_reports',
        station: rawConfig.stationCode,
        dsp: rawConfig.dspCode,
        timeFrame: 'Weekly',
        from: week.amazonWeekLabel,
        to: week.amazonWeekLabel,
      },
    },
    {
      report: 'documents',
      query: {
        dataSetId: 'dsp_station_weekly_documents',
        station: rawConfig.stationCode,
        dsp: rawConfig.dspCode,
        timeFrame: 'Weekly',
        from: week.amazonWeekLabel,
        to: week.amazonWeekLabel,
      },
    },
  ];

  for (const source of supplementarySources) {
    try {
      if (retryPlan?.supplementarySources && !retryPlan.supplementarySources.includes(source.report)) {
        skippedByRetryFilter.push(source.report);
        console.log(`${modeLabel ?? 'Targeted'} mode: skipped supplementary source ${source.report}`);
        continue;
      }
      await tracker?.setPhase('supplementary_exports', source.report);
      logStep(`Checking supplementary source ${source.report}...`);
      const rows = await fetchDataSet(page, rawConfig, source.query);
      console.log(`Source ${source.report} returned ${rows.length} row(s).`);
      sourceFilesByReport[source.report] = rows
        .filter((row) => row?.name)
        .map((row) => normalizeFilename(row.name));
      for (const row of rows) {
        if (!row?.downloadUrl || !row?.name) continue;
        const normalizedName = normalizeFilename(row.name);
        if (!shouldKeepReport(normalizedName, expectations)) {
          console.log(`Skipped non-required supplementary report: ${normalizedName}`);
          continue;
        }
        const target = path.join(downloadDir, normalizedName);
        if (await fileExists(target)) {
          downloadedSupplementaryFiles.push(path.basename(target));
          skippedExistingFiles.push(path.basename(target));
          await tracker?.noteSupplementaryFile(path.basename(target), 'existing');
          console.log(`Skipped existing supplementary report: ${path.basename(target)}`);
          continue;
        }
        await downloadFileToPath(page.request, row.downloadUrl, target, requestTimeoutMs);
        downloadedSupplementaryFiles.push(path.basename(target));
        await tracker?.noteSupplementaryFile(path.basename(target));
        console.log(`Downloaded supplementary report: ${path.basename(target)}`);
      }
      await tracker?.noteSupplementarySource(source.report);
      sourceListingSuccessReports.push(source.report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ report: source.report, error: message });
      sourceListingFailures.push({ report: source.report, error: message });
      await tracker?.noteFailure('supplementary', source.report, message);
      console.log(`Supplementary download failed for ${source.report}: ${message}`);
    }
  }

  const sourceFiles = uniqueStrings(Object.values(sourceFilesByReport).flat());
  const sourceStatus = sourceListingSuccessReports.length > 0
    ? {
        ...buildPatternStatus(sourceFiles, sourceExpectations),
        checkedReports: sourceListingSuccessReports,
        failedReports: sourceListingFailures,
      }
    : (sourceListingFailures.length > 0
      ? {
          unavailable: true,
          checkedReports: [],
          failedReports: sourceListingFailures,
        }
      : null);

  return {
    attempted: true,
    fromDaily,
    toDaily,
    generatedFiles,
    downloadedSupplementaryFiles,
    skippedExistingFiles,
    skippedByRetryFilter,
    sourceFilesByReport,
    sourceStatus,
    sourceListingFailures,
    failures,
  };
}

async function waitForManualDownloadBatch(downloadDir, expectations, allowMissing) {
  const rl = readline.createInterface({ input, output });

  console.log('\nManual-assisted download mode started.');
  console.log('Use the opened browser to trigger any remaining report downloads for this week.');
  console.log(`Target folder: ${downloadDir}`);
  console.log('\nRequired report patterns:');
  for (const p of expectations.requiredPatterns) console.log(`  - ${p}`);
  for (const [pattern, minimum] of Object.entries(expectations.minFileCounts)) {
    console.log(`  - ${pattern} (need at least ${minimum})`);
  }
  if (expectations.optionalPatterns.length > 0) {
    console.log('\nOptional report patterns:');
    for (const p of expectations.optionalPatterns) console.log(`  - ${p}`);
  }

  let status = await summarizeFolder(downloadDir, expectations);

  while (true) {
    const answer = await rl.question('\nPress Enter to validate downloads, or type skip to finish with missing files: ');
    status = await summarizeFolder(downloadDir, expectations);
    printStatus(status);

    const complete = status.missingRequired.length === 0 && status.countFailures.length === 0;
    if (complete) break;
    if (allowMissing || answer.trim().toLowerCase() === 'skip') break;

    console.log('\nKeep the browser open and download the missing files, then press Enter to validate again.');
  }

  rl.close();
  return status;
}

async function main() {
  const args = parseArgs(process.argv);
  const week = inferWeekFolder(args['week-folder']);
  await ensureWeekFolder(week.folder);

  const storageStatePath = path.resolve(repoRoot, config.storageStatePath);
  const downloadRoot = path.resolve(repoRoot, config.downloadRoot);
  const weekDownloadDir = week.folder;
  const expectations = getExpectations(config);
  const allowMissing = parseBool(args['allow-missing'], false);
  const validateOnly = parseBool(args['validate-only'], false);
  const autoExportOnly = parseBool(args['auto-export-only'], false);
  const skipAutoExport = parseBool(args['skip-auto-export'], false);
  const manualAssist = parseBool(args['manual-assist'], false);
  const retryFailuresOnly = parseBool(args['retry-failures-only'], false);
  const supplementaryOnly = parseBool(args['supplementary-only'], false);
  const requestTimeoutMs = parseNumber(args['request-timeout-ms'], parseNumber(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS));
  const navigationTimeoutMs = parseNumber(args['navigation-timeout-ms'], parseNumber(config.navigationTimeoutMs, DEFAULT_NAVIGATION_TIMEOUT_MS));
  const overallTimeoutMs = manualAssist
    ? parseNumber(args['overall-timeout-ms'], parseNumber(config.manualAssistOverallTimeoutMs, 0))
    : parseNumber(args['overall-timeout-ms'], parseNumber(config.overallTimeoutMs, DEFAULT_OVERALL_TIMEOUT_MS));
  const headless = parseBool(args.headless, !manualAssist);

  await ensureWeekFolder(downloadRoot);
  await ensureWeekFolder(weekDownloadDir);

  const priorRunStatus = await readRunStatus(weekDownloadDir);
  const retryPlan = retryFailuresOnly
    ? getRetryFailuresOnlyPlan(priorRunStatus)
    : (supplementaryOnly
      ? { apiReports: [], supplementarySources: ['supplementaryReports', 'documents'] }
      : null);
  const tracker = createRunStatusTracker(weekDownloadDir, createRunStatusState(week, {
    allowMissing,
    validateOnly,
    autoExportOnly,
    skipAutoExport,
    manualAssist,
    retryFailuresOnly,
    supplementaryOnly,
    headless,
    requestTimeoutMs,
    navigationTimeoutMs,
    overallTimeoutMs,
  }, priorRunStatus));

  if (priorRunStatus && priorRunStatus.status !== 'completed') {
    logStep(`Resuming prior run from phase ${priorRunStatus.currentPhase ?? 'unknown'}${priorRunStatus.currentItem ? ` (${priorRunStatus.currentItem})` : ''}.`);
  }

  if (retryFailuresOnly) {
    const targetedItems = (retryPlan?.apiReports?.length ?? 0) + (retryPlan?.supplementarySources?.length ?? 0);
    if (!priorRunStatus || targetedItems === 0) {
      throw new Error('No failed checkpoint items found for --retry-failures-only true. Run the normal downloader first, or rerun without this flag.');
    }
    logStep(`Retrying only failed checkpoint items: ${[
      ...(retryPlan.apiReports ?? []).map((item) => `api:${item}`),
      ...(retryPlan.supplementarySources ?? []).map((item) => `supplementary:${item}`),
    ].join(', ')}`);
  }

  if (supplementaryOnly) {
    logStep('Supplementary-only mode enabled: skipping API CSV regeneration and checking only supplementary/documents feeds.');
  }

  await tracker.persist();

  if (validateOnly) {
    logStep(`Validating existing week folder ${week.folderName}...`);
    const status = await summarizeFolder(weekDownloadDir, expectations);
    const priorManifest = await readManifest(weekDownloadDir);
    const sourceStatus = priorManifest?.sourceStatus ?? null;
    const validationPassed = status.missingRequired.length === 0 && status.countFailures.length === 0;
    printStatus(status, sourceStatus);
    const manifestPath = await writeManifest(weekDownloadDir, status, null, sourceStatus);
    await tracker.finalize(!allowMissing && !validationPassed ? 'failed' : 'completed', {
      manifestPath,
      validationPassed,
      missingRequired: status.missingRequired,
      countFailures: status.countFailures,
      upstreamMissingRequired: sourceStatus?.missingRequired ?? [],
      upstreamCountFailures: sourceStatus?.countFailures ?? [],
      lastError: validationPassed || allowMissing ? null : 'Validation failed: missing required analysis files.',
    });
    console.log(`\nManifest: ${manifestPath}`);
    if (!allowMissing && !validationPassed) {
      throw new Error('Validation failed: missing required analysis files.');
    }
    return;
  }

  try {
    await fs.access(storageStatePath);
  } catch {
    throw new Error(`Missing storage state: ${storageStatePath}. Run npm run amazon:login first.`);
  }

  const runtimeConfig = {
    ...config,
    requestTimeoutMs,
    navigationTimeoutMs,
    overallTimeoutMs,
  };

  let browser;
  try {
    await tracker.setPhase('launching_browser');
    logStep(`Launching browser (headless=${headless})...`);
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      acceptDownloads: true,
      storageState: storageStatePath,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(navigationTimeoutMs);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    const seen = new Set(await fs.readdir(weekDownloadDir));
    page.on('download', async (download) => {
      const suggested = normalizeFilename(download.suggestedFilename());
      const target = path.join(weekDownloadDir, suggested);
      await download.saveAs(target);
      console.log(`Saved: ${target}`);
    });

    const run = async () => {
      const priorManifest = await readManifest(weekDownloadDir);
      await tracker.setPhase('automated_exports');
      const automation = skipAutoExport
        ? { attempted: false, reason: 'Skipped via --skip-auto-export true.', generatedFiles: [], failures: [] }
        : await runAutomatedExports(page, runtimeConfig, week, weekDownloadDir, expectations, tracker, retryPlan);
      const sourceStatus = automation?.sourceStatus ?? priorManifest?.sourceStatus ?? null;

      await tracker.setPhase('validation');
      let status = await summarizeFolder(weekDownloadDir, expectations);
      printStatus(status, sourceStatus);

      if (manualAssist && !autoExportOnly && (allowMissing || status.missingRequired.length > 0 || status.countFailures.length > 0)) {
        const manualStartUrl = getManualStartUrl(runtimeConfig, week);
        await tracker.setPhase('manual_assist');
        logStep(`Opening manual assist page...`);
        await page.goto(manualStartUrl, { waitUntil: 'domcontentloaded' });
        console.log(`Loaded ${manualStartUrl}`);
        console.log(`Week target: ${week.folderName} (${week.amazonWeekLabel})`);
        status = await waitForManualDownloadBatch(weekDownloadDir, expectations, allowMissing);
        await tracker.setPhase('validation');
        printStatus(status, sourceStatus);
      }

      const after = new Set(await fs.readdir(weekDownloadDir));
      const added = [...after].filter((name) => !seen.has(name));
      const manifestPath = await writeManifest(weekDownloadDir, status, automation, sourceStatus);
      const snapshotPath = await writeSnapshotMetadata(weekDownloadDir, status, expectations, sourceStatus);

      console.log('\nDownload summary');
      console.log(`New files: ${added.length}`);
      for (const name of added.sort()) console.log(`  + ${name}`);
      console.log(`Manifest: ${manifestPath}`);
      console.log(`Snapshot metadata: ${snapshotPath}`);

      if (!allowMissing && (status.missingRequired.length > 0 || status.countFailures.length > 0)) {
        const upstreamGaps = [
          ...(sourceStatus?.missingRequired ?? []),
          ...((sourceStatus?.countFailures ?? []).map((entry) => `${entry.pattern} (${entry.actual}/${entry.minimum})`)),
        ];
        const message = upstreamGaps.length > 0
          ? `Download run finished with missing required analysis files. Amazon source feed is also incomplete for: ${upstreamGaps.join(', ')}.`
          : 'Download run finished with missing required analysis files. Re-run after completing the missing downloads, or pass --allow-missing true to bypass.';
        throw new Error(message);
      }

      await tracker.finalize('completed', {
        manifestPath,
        snapshotPath,
        validationPassed: status.missingRequired.length === 0 && status.countFailures.length === 0,
        missingRequired: status.missingRequired,
        countFailures: status.countFailures,
        upstreamMissingRequired: sourceStatus?.missingRequired ?? [],
        upstreamCountFailures: sourceStatus?.countFailures ?? [],
        lastError: null,
      });
    };

    await withTimeout(run(), overallTimeoutMs, 'Download automation');
    await context.storageState({ path: storageStatePath });
    await fs.chmod(storageStatePath, 0o600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await tracker.finalize('failed', { lastError: message });
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
