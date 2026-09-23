import { PutObjectCommand } from '@aws-sdk/client-s3';
import { canonicalArtifactKey } from './amazon-sync-adapters.mjs';

const REQUIRED = ['VIN', 'License Plate', 'YMM', 'Status', 'Fleet Condition Grade', 'Station', 'Session Key', 'Fleet Condition Score', 'Has New Damage', 'Grounding Risk', 'Created At'];

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((item) => item.some((value) => value !== ''));
}

function assessedAt(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]))).toISOString();
}

export function parsePaveExport(bytes) {
  const matrix = parseCsv(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const headers = matrix.shift() || [];
  const missing = REQUIRED.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`PAVE export is missing columns: ${missing.join(', ')}`);
  const at = Object.fromEntries(headers.map((name, index) => [name, index]));
  const rows = matrix.map((cells) => {
    const value = (name) => String(cells[at[name]] || '').trim();
    const gradeLabel = value('Fleet Condition Grade');
    return {
      vin: value('VIN').toUpperCase(), licensePlate: value('License Plate'), vehicleDescription: value('YMM'),
      status: value('Status'), gradeLabel, grade: Number.parseInt(gradeLabel.split('-', 1)[0], 10) || null,
      station: value('Station'), sessionKey: value('Session Key'), conditionScore: Number.parseInt(value('Fleet Condition Score'), 10) || 0,
      hasNewDamage: value('Has New Damage').toLowerCase() === 'yes', groundingRisk: value('Grounding Risk').toLowerCase() === 'yes',
      assessedAt: assessedAt(value('Created At'))
    };
  }).filter((row) => row.vin && row.sessionKey && row.assessedAt);
  if (!rows.length) throw new Error('PAVE export contained no valid assessment rows');
  return rows;
}

async function downloadBytes(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw new Error('PAVE export exceeds 25 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function collectPaveExport({ page, tenantId, bucket, s3 }) {
  await page.goto('https://dashboard.paveapi.com/dashboard', { waitUntil: 'networkidle', timeout: 60_000 });
  if (page.url().includes('/login')) throw Object.assign(new Error('PAVE session requires reauthentication'), { code: 'needs_reauth' });
  const toggle = page.locator('#platformToggle');
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForURL((url) => url.hostname === 'fleet-dashboard.paveapi.com', { timeout: 30_000 });
  }
  const exportButton = page.getByRole('button', { name: /export csv/i });
  await exportButton.waitFor({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), exportButton.click()]);
  const bytes = await downloadBytes(download);
  const rows = parsePaveExport(bytes);
  const filename = download.suggestedFilename() || `pave-${new Date().toISOString().slice(0, 10)}.csv`;
  const artifact = canonicalArtifactKey({ tenantId, feedGroup: 'pave', filename, bytes });
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: artifact.key, Body: bytes, ContentType: 'text/csv', ServerSideEncryption: 'aws:kms' }));
  return { ...artifact, capturedAt: new Date().toISOString(), contentType: 'text/csv', byteLength: bytes.length, rows };
}
