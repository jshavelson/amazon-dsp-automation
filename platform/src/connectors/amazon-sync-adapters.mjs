import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';

const AMAZON_HOST = 'logistics.amazon.com';

const percent = (text, pattern) => {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
};

export function parseFleetConditionReport(text, capturedAt = new Date().toISOString()) {
  const normalized = String(text || '').replace(/&amp;/gi, '&').replace(/\r/g, '');
  const reported = {
    previousQuarterFcaPercent: percent(normalized, /Previous Quarter FCA\s*Compliance\s*([0-9]+(?:\.[0-9]+)?)%/i),
    previousQuarterWearTearPercent: percent(normalized, /Previous Quarter Wear\s*&\s*Tear Compliance\s*([0-9]+(?:\.[0-9]+)?)%/i),
    currentQuarterFcaPercent: percent(normalized, /Current Quarter Rolling FCA\s*Compliance\s*([0-9]+(?:\.[0-9]+)?)%/i),
    currentQuarterWearTearPercent: percent(normalized, /Current Quarter Rolling Wear\s*&\s*Tear Compliance\s*([0-9]+(?:\.[0-9]+)?)%/i),
  };
  const gradeByLabel = { 'Very Poor Condition': 1, 'Poor Condition': 2, 'Fair Condition': 3, 'Good Condition': 4, 'Great Condition': 5 };
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const dashboardRows = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(lines[index])) continue;
    const period = lines.slice(Math.max(0, index - 8), index).reverse().find((line) => /^20\d{2}-\d{2} to 20\d{2}-\d{2}$/.test(line));
    if (!period) continue;
    const conditionIndex = lines.slice(index + 1, index + 9).findIndex((line) => Object.hasOwn(gradeByLabel, line));
    const relativeCondition = conditionIndex < 0 ? null : index + 1 + conditionIndex;
    const status = lines.slice(index + 1, index + 12).find((line) => /^(?:Not )?Compliant(?:\s*-.*)?$/i.test(line)) || 'Not Compliant';
    dashboardRows.push({
      reportingPeriod: period, vin: lines[index], make: lines[index + 1] || null, model: lines[index + 2] || null,
      year: /^20\d{2}$/.test(lines[index + 3] || '') ? Number(lines[index + 3]) : null,
      lastPaveAt: /^\w{3} \d{1,2}, 20\d{2}$/.test(lines[index + 4] || '') ? new Date(lines[index + 4]).toISOString().slice(0, 10) : null,
      gradeLabel: relativeCondition ? lines[relativeCondition] : null,
      wearTearGrade: relativeCondition ? gradeByLabel[lines[relativeCondition]] : null,
      fcaStatus: status
    });
  }
  const periods = [...new Set(dashboardRows.map((row) => row.reportingPeriod))].sort();
  const summarize = (period) => {
    const rows = [...new Map(dashboardRows.filter((row) => row.reportingPeriod === period).map((row) => [row.vin, row])).values()];
    const fcaCompliant = rows.filter((row) => /^Compliant/i.test(row.fcaStatus)).length;
    const wearTearPassing = rows.filter((row) => (row.wearTearGrade ?? 0) >= 3 || /Non-Con|Exclusion|LSC/i.test(row.fcaStatus)).length;
    return { rows, eligible: rows.length, fcaCompliant, wearTearPassing,
      fcaPercent: rows.length ? fcaCompliant / rows.length * 100 : null,
      wearTearPercent: rows.length ? wearTearPassing / rows.length * 100 : null };
  };
  const current = summarize(periods.at(-1));
  const previous = summarize(periods.at(-2));
  const report = {
    previousQuarterFcaPercent: reported.previousQuarterFcaPercent ?? previous.fcaPercent,
    previousQuarterWearTearPercent: reported.previousQuarterWearTearPercent ?? previous.wearTearPercent,
    currentQuarterFcaPercent: reported.currentQuarterFcaPercent ?? current.fcaPercent,
    currentQuarterWearTearPercent: reported.currentQuarterWearTearPercent ?? current.wearTearPercent,
    capturedAt, reportingPeriod: periods.at(-1) || null
  };
  if (Object.values(report).slice(0, 4).some((value) => value === null)) throw new Error('Amazon FCA report metrics are incomplete');
  const vehiclePattern = /\b([A-HJ-NPR-Z0-9]{17})\b\s+([A-Z][A-Z0-9 -]+?)\s+([A-Z0-9][A-Z0-9 -]+?)\s+(20\d{2})\s+(20\d{2}-\d{2}-\d{2})\s+(20\d{2}-\d{2}-\d{2})\s+([0-5])\b/g;
  const vehicles = current.rows.length ? current.rows : [];
  for (const match of normalized.matchAll(vehiclePattern)) vehicles.push({
    vin: match[1], make: match[2].trim(), model: match[3].trim(), year: Number(match[4]),
    dueDate: match[5], lastPaveAt: match[6], wearTearGrade: Number(match[7]), fcaStatus: 'compliant'
  });
  const unique = new Map(vehicles.map((row) => [row.vin, row]));
  const rows = [...unique.values()];
  const passing = rows.filter((row) => (row.wearTearGrade ?? 0) >= 3 || /Non-Con|Exclusion|LSC/i.test(row.fcaStatus || '')).length;
  if (rows.length && Math.abs((passing / rows.length * 100) - report.currentQuarterWearTearPercent) > 0.05) {
    throw new Error('Amazon FCA VIN grades do not reconcile with Wear & Tear compliance');
  }
  const compliant = rows.filter((row) => /^Compliant/i.test(row.fcaStatus || '')).length;
  return { report: { ...report, eligibleVehicleCount: rows.length || null, compliantVehicleCount: rows.length ? compliant : null, wearTearPassingCount: rows.length ? passing : null }, vehicles: rows };
}

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
  },
  fleet_condition: {
    page: `https://${AMAZON_HOST}/performance?pageId=dsp_supp_reports&timeFrame=Weekly`,
    collect: async (page) => {
      const link = page.getByText(/Fleet Condition Assessment.*Wear.*Tear/i).first();
      await link.waitFor({ state: 'visible', timeout: 60_000 });
      const popup = page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => null);
      await link.click();
      const reportPage = await popup || page;
      await reportPage.waitForLoadState('domcontentloaded');
      const dashboardFrame = reportPage.frames().find((frame) => frame.url().includes('/dashboards/'));
      if (!dashboardFrame) throw new Error('Amazon FCA embedded dashboard did not load');
      await dashboardFrame.getByRole('tab', { name: /Fleet Condition Assessment.*Grading/i }).click();
      await dashboardFrame.waitForTimeout(3_000);
      const bodyParts = [await dashboardFrame.locator('body').innerText({ timeout: 60_000 })];
      const scroll = await dashboardFrame.locator('*').evaluateAll((elements) => {
        const candidates = elements.filter((element) => element.scrollHeight > element.clientHeight + 100 && element.clientHeight > 100)
          .sort((left, right) => right.scrollHeight - left.scrollHeight);
        const target = candidates[0];
        if (!target) return null;
        target.setAttribute('data-fca-scroll-target', 'true');
        return { height: target.scrollHeight, viewport: target.clientHeight };
      });
      if (scroll) {
        const target = dashboardFrame.locator('[data-fca-scroll-target="true"]');
        const step = Math.max(100, Math.floor(scroll.viewport * 0.75));
        for (let top = step; top < scroll.height; top += step) {
          await target.evaluate((element, position) => { element.scrollTop = position; }, top);
          await dashboardFrame.waitForTimeout(150);
          bodyParts.push(await dashboardFrame.locator('body').innerText());
        }
        await target.evaluate((element) => { element.scrollTop = 0; });
      }
      const reportText = bodyParts.join('\n');
      return { reportUrl: reportPage.url(), reportText, ...parseFleetConditionReport(reportText) };
    }
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
  return { ...artifact, capturedAt: new Date().toISOString(), contentType: 'application/json', byteLength: bytes.length,
    normalized: feedGroup === 'fleet_condition' ? { report: payload.report, vehicles: payload.vehicles } : null };
}
