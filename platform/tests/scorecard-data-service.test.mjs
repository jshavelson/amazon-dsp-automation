import test from 'node:test';
import assert from 'node:assert/strict';

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
