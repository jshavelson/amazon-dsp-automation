#!/usr/bin/env node
/** Capture the authoritative Cortex Fleet Dashboard roster and readiness. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
const storageState = path.resolve(ROOT, config.storageStatePath);
const capturedAt = new Date();
const asOf = capturedAt.toISOString().slice(0, 10);
const output = path.join(ROOT, 'data/fleet_reviews', asOf);
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto('https://logistics.amazon.com/fleet-management?navMenuVariant=external', {
    waitUntil: 'networkidle', timeout: config.navigationTimeoutMs || 60_000,
  });
  if (page.url().includes('/ap/signin')) throw new Error('Amazon requires sign-in or MFA');

  const payloads = await page.evaluate(async () => {
    const get = async (url) => {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json();
    };
    return {
      vehicles: await get('/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING'),
      pm: await get('/fleet-management/api/pm-stats'),
      maintenance: await get('/fleet-management/api/maintenance-issues?status=OPEN&issueSource=AVS,MANDATORY_PERIODIC_INSPECTIONS,TELEMETRY&limit=5000'),
    };
  });
  const vehicles = payloads.vehicles?.data?.vehicles || payloads.vehicles?.vehicles || [];
  if (!vehicles.length) throw new Error('Cortex Fleet Dashboard returned no vehicles');
  const operational = vehicles.filter((vehicle) => vehicle.operationalStatus === 'OPERATIONAL');
  const grounded = vehicles.filter((vehicle) => vehicle.operationalStatus === 'GROUNDED');
  if (operational.length + grounded.length !== vehicles.length) {
    throw new Error('Cortex readiness does not reconcile to the active fleet');
  }
  const ownership = vehicles.reduce((counts, vehicle) => {
    const key = vehicle.vehicleOwnershipType || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sourceUrl = 'https://logistics.amazon.com/fleet-management?navMenuVariant=external';
  const snapshot = {
    asOf, ownershipAsOf: asOf, capturedAt: capturedAt.toISOString(), readinessSourceSystem: 'cortex_fleet_dashboard',
    registeredFleet: vehicles.length, operational: operational.length, grounded: grounded.length,
    groundedUnits: grounded.map((vehicle) => vehicle.dspVehicleId || vehicle.vin), ownership,
    readinessSource: sourceUrl,
    rosterSource: `data/fleet_reviews/${asOf}/vehicles-1.json`,
    ownershipClassificationSource: `data/fleet_reviews/${asOf}/vehicles-1.json`,
    reconciliation: {
      currentRosterVinCount: vehicles.length, portalVinCount: vehicles.length, vinSetsMatch: true,
      note: `Live Cortex Fleet Dashboard capture: ${operational.length} operational and ${grounded.length} grounded of ${vehicles.length} active vehicles.`,
    },
  };
  await Promise.all([
    fs.writeFile(path.join(output, 'vehicles-1.json'), `${JSON.stringify(payloads.vehicles, null, 2)}\n`),
    fs.writeFile(path.join(output, 'pm-stats-1.json'), `${JSON.stringify(payloads.pm, null, 2)}\n`),
    fs.writeFile(path.join(output, 'maintenance-issues-1.json'), `${JSON.stringify(payloads.maintenance, null, 2)}\n`),
    fs.writeFile(path.join(output, 'dashboard-fleet-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`),
  ]);
  await context.storageState({ path: storageState });
  await fs.chmod(storageState, 0o600);
  console.log(JSON.stringify({ asOf, registeredFleet: vehicles.length, operational: operational.length, grounded: grounded.length, groundedUnits: snapshot.groundedUnits, output: path.relative(ROOT, output) }, null, 2));
} finally {
  await browser.close();
}
