#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/adp.config.json'), 'utf8'));

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const startDate = argument('start');
const endDate = argument('end');
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || startDate > endDate) {
  throw new Error('Usage: adp_our_data_snapshot.mjs --start YYYY-MM-DD --end YYYY-MM-DD');
}

function processOutput(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`Secure credential lookup failed${diagnostic ? `: ${diagnostic}` : ''}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
  });
}

async function keychainValue(service) {
  const value = await processOutput('security', [
    'find-generic-password', '-w', '-s', service, '-a', config.keychainAccount,
  ]);
  if (!value) throw new Error(`Keychain item ${service} is empty`);
  return value;
}

function curlRequest({ requestPath, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-q', '--silent', '--show-error', '--http1.1', '--config', '-',
      '--cert', config.certificatePath, '--key', config.privateKeyPath,
      '--max-time', String(Math.ceil(config.requestTimeoutMs / 1000)),
      '--write-out', '\n__ADP_HTTP_STATUS__:%{http_code}',
    ];
    if (body) args.push('--data-raw', body);
    const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      const marker = '\n__ADP_HTTP_STATUS__:';
      const markerIndex = output.lastIndexOf(marker);
      if (code !== 0 || markerIndex < 0) {
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`ADP HTTPS request failed (curl ${code}${diagnostic ? `: ${diagnostic}` : ''})`));
        return;
      }
      const status = Number(output.slice(markerIndex + marker.length).trim());
      const responseBody = output.slice(0, markerIndex);
      let document;
      try {
        document = JSON.parse(responseBody);
      } catch {
        reject(new Error(`ADP returned non-JSON content (HTTP ${status})`));
        return;
      }
      resolve({ status, document });
    });
    const lines = [
      `url = "https://${config.apiHost}${requestPath}"`,
      `request = "${method}"`,
      'header = "Accept: application/json"',
      ...Object.entries(headers).map(([name, value]) => `header = "${name}: ${value}"`),
    ];
    child.stdin.end(`${lines.join('\n')}\n`);
  });
}

async function token() {
  const [clientId, clientSecret] = await Promise.all([
    keychainValue(config.keychainClientIdService),
    keychainValue(config.keychainClientSecretService),
  ]);
  const authorization = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const originalHost = config.apiHost;
  config.apiHost = config.accountsHost;
  try {
    const response = await curlRequest({
      requestPath: config.tokenPath,
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (response.status !== 200 || !response.document.access_token) {
      throw new Error(`ADP token request failed (HTTP ${response.status})`);
    }
    return response.document.access_token;
  } finally {
    config.apiHost = originalHost;
  }
}

function reportsTo(assignment) {
  return Array.isArray(assignment?.reportsTo)
    ? assignment.reportsTo
    : (assignment?.reportsTo ? [assignment.reportsTo] : []);
}

function slimWorker(worker) {
  return {
    associateOID: worker.associateOID || null,
    workerID: worker.workerID || null,
    workerStatus: worker.workerStatus || null,
    legalName: worker.person?.legalName || null,
    preferredName: worker.person?.preferredName || null,
    workerDates: worker.workerDates || null,
    workAssignments: (worker.workAssignments || []).map((assignment) => ({
      itemID: assignment.itemID || null,
      primaryIndicator: assignment.primaryIndicator || false,
      assignmentStatus: assignment.assignmentStatus || null,
      hireDate: assignment.hireDate || null,
      terminationDate: assignment.terminationDate || null,
      jobCode: assignment.jobCode || null,
      jobTitle: assignment.jobTitle || null,
      homeOrganizationalUnits: assignment.homeOrganizationalUnits || null,
      assignedOrganizationalUnits: assignment.assignedOrganizationalUnits || null,
      payrollFileNumber: assignment.payrollFileNumber || null,
      payrollGroupCode: assignment.payrollGroupCode || null,
      payCycleCode: assignment.payCycleCode || null,
      workerTimeProfile: assignment.workerTimeProfile || null,
      reportsTo: reportsTo(assignment).map((relationship) => ({
        associateOID: relationship.associateOID || null,
        workerID: relationship.workerID || null,
      })),
    })),
  };
}

function durationHours(value) {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value || '');
  if (!match) return 0;
  return Number(match[1] || 0) * 24 + Number(match[2] || 0) + Number(match[3] || 0) / 60 + Number(match[4] || 0) / 3600;
}

function slimTeamCard(teamCard) {
  const timeCards = (teamCard.timeCards || []).map((card) => {
    const dayEntries = (card.dayEntries || []).filter((day) => day.entryDate >= startDate && day.entryDate <= endDate)
      .map((day) => ({
        entryDate: day.entryDate,
        totalPeriodTimeDuration: day.totalPeriodTimeDuration || null,
      }));
    return {
      timeCardID: card.timeCardID || null,
      timePeriod: card.timePeriod || null,
      processingStatusCode: card.processingStatusCode || null,
      dayEntries,
    };
  }).filter((card) => card.dayEntries.length > 0);
  return {
    associateOID: teamCard.associateOID || null,
    workerID: teamCard.workerID || null,
    personLegalName: teamCard.personLegalName || null,
    timeCards,
  };
}

const accessToken = await token();
const authHeaders = { Authorization: `Bearer ${accessToken}` };
const workers = [];
for (let skip = 0; skip < 5000; skip += 100) {
  const response = await curlRequest({
    requestPath: `/hr/v2/workers?$top=100&$skip=${skip}`,
    headers: authHeaders,
  });
  if (response.status !== 200) throw new Error(`ADP workers request failed (HTTP ${response.status})`);
  const page = Array.isArray(response.document.workers) ? response.document.workers : [];
  if (skip > 0 && page[0]?.associateOID && page[0].associateOID === workers[0]?.associateOID) break;
  workers.push(...page);
  if (page.length < 100) break;
}

const uniqueWorkers = [...new Map(workers.filter((worker) => worker.associateOID).map((worker) => [worker.associateOID, worker])).values()];
const managerOIDs = [...new Set(uniqueWorkers.flatMap((worker) => (worker.workAssignments || []).flatMap(reportsTo))
  .map((relationship) => relationship.associateOID).filter(Boolean))];
const teamCardsByWorker = new Map();
for (const managerOID of managerOIDs) {
  const response = await curlRequest({
    requestPath: `/time/v2/workers/${encodeURIComponent(managerOID)}/team-time-cards?$expand=dayEntries`,
    headers: authHeaders,
  });
  if (response.status !== 200) continue;
  for (const teamCard of response.document.teamTimeCards || []) {
    const slim = slimTeamCard(teamCard);
    if (slim.associateOID && slim.timeCards.length > 0) teamCardsByWorker.set(slim.associateOID, slim);
  }
}

const slimWorkers = uniqueWorkers.map(slimWorker);
const teamCards = [...teamCardsByWorker.values()];
const employeeSummaries = teamCards.map((teamCard) => {
  const days = teamCard.timeCards.flatMap((card) => card.dayEntries);
  return {
    associateOID: teamCard.associateOID,
    workerID: teamCard.workerID,
    workedDayCount: days.filter((day) => durationHours(day.totalPeriodTimeDuration) > 0).length,
    totalHours: Number(days.reduce((sum, day) => sum + durationHours(day.totalPeriodTimeDuration), 0).toFixed(4)),
  };
});
const summary = {
  source: 'ADP Workforce Now API',
  capturedAt: new Date().toISOString(),
  period: { startDate, endDate },
  workerCount: slimWorkers.length,
  managerCount: managerOIDs.length,
  employeesWithTime: employeeSummaries.length,
  workedDayEntries: employeeSummaries.reduce((sum, employee) => sum + employee.workedDayCount, 0),
  totalHours: Number(employeeSummaries.reduce((sum, employee) => sum + employee.totalHours, 0).toFixed(4)),
  employeesWithFiveOrMoreWorkedDays: employeeSummaries.filter((employee) => employee.workedDayCount >= 5).length,
  payrollOutputStatus: 'needs CAR scope; API probe returned HTTP 403',
};

const outputDir = path.join(ROOT, 'data/adp', `${startDate}_to_${endDate}`);
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
await fs.chmod(outputDir, 0o700);
await Promise.all([
  fs.writeFile(path.join(outputDir, 'workers.json'), `${JSON.stringify(slimWorkers, null, 2)}\n`, { mode: 0o600 }),
  fs.writeFile(path.join(outputDir, 'time-cards.json'), `${JSON.stringify(teamCards, null, 2)}\n`, { mode: 0o600 }),
  fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 }),
]);
console.log(JSON.stringify(summary, null, 2));
