import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  getLatestWeekFolder,
  getDriverPerformance,
  getPerformanceDashboard,
  parseCSV
} from '../src/services/scorecard-data-service.mjs';

test('CSV parser preserves quoted commas and strips the UTF-8 BOM', () => {
  assert.deepEqual(parseCSV('\uFEFF"Name","Packages"\n"Doe, Jane","1,234"\n'), [
    { Name: 'Doe, Jane', Packages: '1,234' }
  ]);
});

test('connected scorecard service resolves and reads the latest actual week', async () => {
  assert.match(getLatestWeekFolder(), /^\d{4}-wk\d{2}$/);
  const result = await getDriverPerformance();
  assert.equal(result.week, getLatestWeekFolder());
  assert.ok(result.drivers.length > 0);
  assert.ok(result.drivers.every((driver) => driver.id && driver.name));
});

test('performance dashboard is derived from scorecard rows and history', async () => {
  const result = await getPerformanceDashboard();
  assert.equal(result.drivers.length, result.dspPerformance.driverCount);
  assert.ok(result.history.length > 0);
  assert.equal(result.history.at(-1).period, result.period);
  assert.ok(result.dspPerformance.totalDeliveries > 0);
  assert.ok(Number.isFinite(result.history.at(-1).overallScore));
  assert.equal(result.dspPerformance.overallScore, result.history.at(-1).overallScore);
  assert.ok(result.history.at(-1).averageDaScore > result.history.at(-1).overallScore);
});

test('operational APIs do not synthesize business facts or pin historical weeks', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const files = [
    'platform/src/api/driver-performance-routes.mjs',
    'platform/src/api/disputes-routes.mjs',
    'platform/src/api/payroll-routes.mjs',
    'platform/src/api/react-compat-routes.mjs',
    'platform/src/services/pave-service.mjs',
    'platform/src/services/scorecard-data-service.mjs',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /Math\.random\s*\(/, 'random values cannot represent operational data');
  assert.doesNotMatch(source, /2026-wk(?:35|36|37|38)/, 'API defaults cannot pin a historical week');
  assert.doesNotMatch(source, /Fallback to mock|Generate mock|return mock/i, 'mock fallbacks cannot execute in production APIs');
});

test('packaged operational snapshots expose provenance', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  for (const name of ['performance', 'fleet-compliance', 'fleet-costs', 'connections', 'weekly-evaluations']) {
    const payload = JSON.parse(fs.readFileSync(path.join(root, 'platform/operational-snapshots', `${name}.json`), 'utf8'));
    assert.ok(payload.generatedAt || payload.asOf, `${name} requires a generatedAt or asOf timestamp`);
  }
});
