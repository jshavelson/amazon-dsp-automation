import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const reportDate = process.argv[2] || formatter.format(new Date(Date.now() - 12 * 60 * 60 * 1000));
if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
  throw new Error('Usage: verify_daily_operations_delivery.mjs [YYYY-MM-DD]');
}

const failures = [];
const receipts = [];
for (const audience of ['owner', 'management']) {
  const base = path.join(ROOT, 'data', 'email_inbox', audience, reportDate);
  const receiptPath = path.join(base, 'sent.json');
  try {
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    if (!receipt.messageId || receipt.audience !== audience || receipt.date !== reportDate) {
      failures.push(`${audience}: invalid send receipt`);
      continue;
    }
    receipts.push({audience, messageId: receipt.messageId, sentAt: receipt.sentAt});
  } catch {
    let lock = false;
    try {
      await fs.access(path.join(base, 'delivery.lock'));
      lock = true;
    } catch {}
    failures.push(`${audience}: missing send receipt${lock ? ' (delivery lock present)' : ''}`);
  }
}

if (failures.length) {
  throw new Error(`Daily Operations Brief delivery verification failed for ${reportDate}: ${failures.join('; ')}`);
}

console.log(JSON.stringify({verified: true, reportDate, receipts}));
