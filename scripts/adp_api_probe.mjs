#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/adp.config.json'), 'utf8'));

function readProcessOutput(command, args) {
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
        reject(new Error(`macOS Keychain lookup failed${diagnostic ? `: ${diagnostic}` : ''}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
  });
}

async function readKeychainValue(service) {
  const value = await readProcessOutput('security', [
    'find-generic-password',
    '-w',
    '-s', service,
    '-a', config.keychainAccount,
  ]);
  if (!value) throw new Error(`ADP Keychain item ${service} is empty`);
  return value;
}

function curlRequest({ host, requestPath, method, certPath, keyPath, headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    // curl honors the Gateway-provided HTTPS_PROXY and CA variables. Request
    // secrets/tokens are supplied over stdin, never command-line arguments.
    const args = [
      '-q', '--silent', '--show-error', '--http1.1', '--config', '-',
      '--cert', certPath, '--key', keyPath,
      '--max-time', String(Math.ceil(config.requestTimeoutMs / 1000)),
      '--write-out', '\\n__ADP_HTTP_STATUS__:%{http_code}',
    ];
    if (body) args.push('--data-raw', body);
    const child = spawn('curl', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
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
      resolve({
        status: Number(output.slice(markerIndex + marker.length).trim()),
        body: output.slice(0, markerIndex),
      });
    });
    const lines = [
      `url = "https://${host}${requestPath}"`,
      `request = "${method}"`,
      'header = "Accept: application/json"',
      ...Object.entries(headers).map(([name, value]) => `header = "${name}: ${value}"`),
    ];
    child.stdin.end(`${lines.join('\n')}\n`);
  });
}

function parseJson(response, label) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${label} returned non-JSON content (HTTP ${response.status})`);
  }
}

function responseMetadata(response) {
  let document = null;
  try {
    document = JSON.parse(response.body);
  } catch {
    // Metadata-only probes can report a non-JSON response without retaining it.
  }
  return {
    http_status: response.status,
    response_keys: document && typeof document === 'object' ? Object.keys(document).sort() : [],
    error_code: document?.error || document?.errorCode || document?.code || null,
    response_status_code: document?.response?.responseCode || document?.confirmMessage?.requestStatusCode?.codeValue || null,
    process_messages: Array.isArray(document?.confirmMessage?.processMessages)
      ? document.confirmMessage.processMessages.map((message) => ({
        type: message.messageTypeCode?.codeValue || null,
        text: message.userMessage?.messageTxt || null,
      }))
      : [],
  };
}

function timeCardSchemaMetadata(response) {
  try {
    const document = JSON.parse(response.body);
    const teamCard = Array.isArray(document.teamTimeCards) ? document.teamTimeCards[0] : null;
    const card = Array.isArray(teamCard?.timeCards) ? teamCard.timeCards[0] : null;
    const day = Array.isArray(card?.dayEntries) ? card.dayEntries[0] : null;
    const entry = Array.isArray(day?.timeEntries) ? day.timeEntries[0] : null;
    const periods = (document.teamTimeCards || []).flatMap((item) => item.timeCards || [])
      .map((item) => item.timePeriod)
      .filter(Boolean);
    return {
      team_time_card_count_in_probe: Array.isArray(document.teamTimeCards) ? document.teamTimeCards.length : 0,
      team_time_card_keys: teamCard ? Object.keys(teamCard).sort() : [],
      time_card_keys: card ? Object.keys(card).sort() : [],
      day_entry_keys: day ? Object.keys(day).sort() : [],
      time_entry_keys: entry ? Object.keys(entry).sort() : [],
      returned_periods: [...new Set(periods.map((period) => `${period.startDate || ''}/${period.endDate || ''}`))].sort(),
    };
  } catch {
    return {
      team_time_card_count_in_probe: 0,
      team_time_card_keys: [],
      time_card_keys: [],
      day_entry_keys: [],
      time_entry_keys: [],
      returned_periods: [],
    };
  }
}

async function main() {
  const [clientId, clientSecret] = await Promise.all([
    readKeychainValue(config.keychainClientIdService),
    readKeychainValue(config.keychainClientSecretService),
  ]);
  const basicAuthorization = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  await Promise.all([
    fs.access(config.certificatePath),
    fs.access(config.privateKeyPath),
  ]);
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
  }).toString();
  const tokenResponse = await curlRequest({
    host: config.accountsHost,
    requestPath: config.tokenPath,
    method: 'POST',
    certPath: config.certificatePath,
    keyPath: config.privateKeyPath,
    headers: {
      Authorization: `Basic ${basicAuthorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenBody,
  });
  const tokenDocument = parseJson(tokenResponse, 'ADP token endpoint');
  if (tokenResponse.status !== 200 || !tokenDocument.access_token) {
    const detail = tokenDocument.error_description || tokenDocument.errorSummary || '';
    throw new Error(`ADP token request failed (HTTP ${tokenResponse.status}, error ${tokenDocument.error || 'unknown'}${detail ? `: ${detail}` : ''})`);
  }

  const workerResponse = await curlRequest({
    host: config.apiHost,
    requestPath: config.workerProbePath,
    method: 'GET',
    certPath: config.certificatePath,
    keyPath: config.privateKeyPath,
    headers: { Authorization: `Bearer ${tokenDocument.access_token}` },
  });
  const workerDocument = parseJson(workerResponse, 'ADP worker endpoint');
  const workers = Array.isArray(workerDocument.workers) ? workerDocument.workers : [];
  const firstWorker = workers[0] || null;
  const reportsTo = workers.flatMap((worker) => (
    Array.isArray(worker?.workAssignments)
      ? worker.workAssignments.flatMap((assignment) => (
      Array.isArray(assignment.reportsTo) ? assignment.reportsTo : (assignment.reportsTo ? [assignment.reportsTo] : [])
      ))
      : []
  ));
  const managerAssociateOID = reportsTo.find((relationship) => relationship?.associateOID)?.associateOID || null;
  const payrollOutputResponse = await curlRequest({
    host: config.apiHost,
    requestPath: config.payrollOutputProbePath,
    method: 'GET',
    certPath: config.certificatePath,
    keyPath: config.privateKeyPath,
    headers: { Authorization: `Bearer ${tokenDocument.access_token}` },
  });
  let timeCardResponse = null;
  if (managerAssociateOID) {
    timeCardResponse = await curlRequest({
      host: config.apiHost,
      requestPath: `/time/v2/workers/${encodeURIComponent(managerAssociateOID)}/team-time-cards?$top=1&$expand=dayEntries`,
      method: 'GET',
      certPath: config.certificatePath,
      keyPath: config.privateKeyPath,
      headers: { Authorization: `Bearer ${tokenDocument.access_token}` },
    });
  }
  const health = {
    status: workerResponse.status === 200 ? 'connected' : 'token_valid_api_not_authorized',
    checked_at: new Date().toISOString(),
    token_http_status: tokenResponse.status,
    token_expires_in_seconds: Number(tokenDocument.expires_in || 0),
    worker_probe_http_status: workerResponse.status,
    worker_response_keys: workerResponse.status === 200 ? Object.keys(workerDocument).sort() : [],
    worker_count_in_probe: Array.isArray(workerDocument.workers) ? workerDocument.workers.length : 0,
    worker_record_keys: firstWorker ? Object.keys(firstWorker).sort() : [],
    worker_person_keys: firstWorker?.person ? Object.keys(firstWorker.person).sort() : [],
    worker_assignment_keys: Array.isArray(firstWorker?.workAssignments) && firstWorker.workAssignments[0]
      ? Object.keys(firstWorker.workAssignments[0]).sort()
      : [],
    meta_keys: workerDocument.meta ? Object.keys(workerDocument.meta).sort() : [],
    payroll_output_probe: responseMetadata(payrollOutputResponse),
    time_card_probe: timeCardResponse ? {
      ...responseMetadata(timeCardResponse),
      ...timeCardSchemaMetadata(timeCardResponse),
    } : null,
    api_error_code: workerResponse.status === 200 ? null : (workerDocument.error || workerDocument.errorCode || 'unknown'),
  };
  const healthPath = path.resolve(ROOT, config.healthPath);
  await fs.mkdir(path.dirname(healthPath), { recursive: true });
  await fs.writeFile(healthPath, `${JSON.stringify(health, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify(health, null, 2));
  if (workerResponse.status !== 200) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
