import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';

const AMAZON_HOST = 'logistics.amazon.com';
const feedDefinitions = Object.freeze({
  fleet_readiness: {
    page: `https://${AMAZON_HOST}/fleet-management?navMenuVariant=external`,
    collect: async (page) => page.evaluate(async () => {
      const get = async (url) => {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        return response.json();
      };
      return {
        vehicles: await get('/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING'),
        preventiveMaintenance: await get('/fleet-management/api/pm-stats'),
        maintenanceIssues: await get('/fleet-management/api/maintenance-issues?status=OPEN&issueSource=AVS,MANDATORY_PERIODIC_INSPECTIONS,TELEMETRY&limit=5000')
      };
    })
  }
});

export const amazonSyncFeedGroups = Object.freeze(Object.keys(feedDefinitions));

function safeSegment(value, label) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value || '')) throw new Error(`invalid ${label}`);
  return value;
}

export function canonicalArtifactKey({ tenantId, feedGroup, filename, bytes }) {
  safeSegment(tenantId, 'tenant');
  safeSegment(feedGroup, 'feed group');
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { key: `tenants/${tenantId}/${feedGroup}/${digest.slice(0, 12)}-${safeName}`, sha256: digest };
}

export async function collectAmazonFeed({ page, tenantId, feedGroup, periodStart, periodEnd, bucket, s3 }) {
  const definition = feedDefinitions[feedGroup];
  if (!definition) throw new Error(`Amazon sync adapter is unavailable for ${feedGroup}`);
  await page.goto(definition.page, { waitUntil: 'networkidle', timeout: 60_000 });
  if (page.url().includes('/ap/signin')) throw Object.assign(new Error('Amazon session requires reauthentication'), { code: 'needs_reauth' });
  const payload = await definition.collect(page, { periodStart, periodEnd });
  const bytes = Buffer.from(`${JSON.stringify({ feedGroup, periodStart, periodEnd, capturedAt: new Date().toISOString(), payload }, null, 2)}\n`);
  const artifact = canonicalArtifactKey({ tenantId, feedGroup, filename: `${periodStart}_${periodEnd}.json`, bytes });
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: artifact.key, Body: bytes, ContentType: 'application/json', ServerSideEncryption: 'aws:kms' }));
  return { ...artifact, capturedAt: new Date().toISOString(), contentType: 'application/json', byteLength: bytes.length };
}
