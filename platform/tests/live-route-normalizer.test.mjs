import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRouteSummaries } from '../../scripts/live_route_normalizer.mjs';

test('normalizes live Delivery Execution names and flags stalled multi-route work', () => {
  const capturedAt = '2026-09-22T18:00:00.000Z';
  const payload = normalizeRouteSummaries({ transporters: [{
    transporterId: 'A1', firstName: 'Current', lastName: 'Driver',
  }], rmsRouteSummaries: [{
    routeId: 'r1', routeCode: 'CX101', plannedDepartureTime: Date.parse('2026-09-22T12:00:00Z'),
    localDate: [2026, 9, 22], transporters: [{
      transporterId: 'A1', vin: 'VIN1', itineraryStatus: 'IN_PROGRESS', actualRouteDepartureTime: Date.parse('2026-09-22T12:20:00Z'),
      lastDriverEventTime: Date.parse('2026-09-22T17:00:00Z'), timeRemainingSecs: 3600,
      associatedRoutes: [{ routeId: 'r1', routeCode: 'CX101' }, { routeId: 'r2', routeCode: 'CX102' }],
      routeDeliveryProgress: { totalStops: 100, completedStops: 40, routePackageSummary: { DELIVERED: 90, REMAINING: 110 } }
    }]
  }] }, { capturedAt, deliveryDate: '2026-09-22' });
  assert.equal(payload.routeCount, 1);
  assert.equal(payload.routes[0].completionPct, 40);
  assert.equal(payload.routes[0].driverName, 'Current Driver');
  assert.equal(payload.routes[0].risk, 'stalled');
  assert.equal(payload.routes[0].isMultiRoute, true);
  assert.equal(payload.summary.inProgress, 1);
  assert.equal(payload.summary.stalled, 1);
  assert.equal(payload.summary.multiRoute, 1);
});
