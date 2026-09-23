const emptyLivePayload = (message, needsReauth = false) => ({
  period: null, capturedAt: null, source: 'Amazon Delivery Execution', live: false, stale: true,
  needsData: true, needsReauth, message, routeCount: 0,
  summary: { assigned: 0, inProgress: 0, completed: 0, behind: 0, stalled: 0, lateDepartures: 0, multiRoute: 0 },
  routes: [],
});
const canonicalRoutes = (rows) => [...rows.reduce((groups, row) => {
  const code = row.routeCode || row.routeId;
  const current = groups.get(code) || [];
  current.push(row); groups.set(code, current); return groups;
}, new Map()).entries()].map(([, rows]) => {
  const primary = [...rows].sort((a, b) => Number(b.totalStops || 0) - Number(a.totalStops || 0))[0];
  const additionalTransporters = rows.filter((row) => row !== primary && row.transporterId !== primary.transporterId).map((row) => {
    const associatedRouteCount = row.associatedRoutes?.length || 0;
    const role = associatedRouteCount > 1
      ? 'Sweeper / multi-route'
      : row.rescueCount || Number(row.totalStops || 0) < Number(primary.totalStops || 0)
        ? 'Rescuer'
        : 'Additional driver';
    return {
      transporterId: row.transporterId, driverName: row.driverName, vin: row.vin, role,
      completedStops: row.completedStops || 0, totalStops: row.totalStops || 0,
      stopsLastHour: row.stopsLastHour || 0,
    };
  });
  return { ...primary, transporterCount: rows.length, additionalTransporters };
}).sort((a, b) => a.routeCode.localeCompare(b.routeCode));

export function routeMonitorRoutes(app, { repository, logger, referenceTenantSlug = 'jec-logistics' }) {
  app.get('/api/route-monitor', async (request, reply) => {
    try {
      const result = await repository.listLiveRoutes(request.tenantContext, {
        date: request.query.date, limit: Math.min(Number(request.query.limit) || 250, 500),
      });
      if (!result.items?.length) {
        const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(request.query.date || '') ? request.query.date : null;
        const dispatchPlan = deliveryDate && repository.getDispatchDayPlan
          ? await repository.getDispatchDayPlan(request.tenantContext, deliveryDate)
          : { expectedRoutes: 0, sweepers: 0 };
        return reply.send({
          ...emptyLivePayload('No same-day route execution snapshot has been ingested for this tenant.'),
          period: deliveryDate,
          dispatchPlan,
          assignmentOptions: { drivers: [], vans: [], phones: [] },
        });
      }
      const routes = canonicalRoutes(result.items);
      let capturedAt = null;
      const summary = { assigned: 0, inProgress: 0, completed: 0, behind: 0, stalled: 0, lateDepartures: 0, multiRoute: 0 };
      for (const row of routes) {
        if (!capturedAt || row.capturedAt > capturedAt) capturedAt = row.capturedAt;
        if (row.status === 'assigned') summary.assigned += 1;
        else if (row.status === 'in_progress') summary.inProgress += 1;
        else if (row.status === 'completed') summary.completed += 1;
        if (row.risk === 'behind') summary.behind += 1;
        else if (row.risk === 'stalled') summary.stalled += 1;
        else if (row.risk === 'late_departure') summary.lateDepartures += 1;
        if (row.isMultiRoute) summary.multiRoute += 1;
      }
      const stale = Date.now() - Date.parse(capturedAt) > 15 * 60 * 1000;
      const deliveryDate = routes[0].deliveryDate;
      const [vans, assignments, dispatchPlan] = await Promise.all([
        repository.listVans?.(request.tenantContext, { limit: 500 }) || { items: [] },
        repository.listDispatchRouteAssignments?.(request.tenantContext, deliveryDate) || [],
        repository.getDispatchDayPlan?.(request.tenantContext, deliveryDate) || { expectedRoutes: 0, sweepers: 0 },
      ]);
      const assignmentByRoute = new Map(assignments.map((item) => [item.routeCode, item]));
      for (const route of routes) {
        const saved = assignmentByRoute.get(route.routeCode) || {};
        route.dispatchAssignment = {
          ...saved,
          driverId: saved.driverId || route.transporterId || '',
          driverName: saved.driverName || route.driverName || '',
        };
      }
      const activeDrivers = [...new Map(result.items.filter((item) => item.transporterId && item.driverName).map((item) => [item.transporterId, { id: item.transporterId, label: item.driverName, status: 'ACTIVE', source: 'Amazon Delivery Execution · same-day' }])).values()];
      const driverNames = new Map(activeDrivers.map((driver) => [driver.id, driver.label]));
      for (const route of routes) {
        route.driverName ||= driverNames.get(route.transporterId) || '';
        for (const additional of route.additionalTransporters || []) {
          additional.driverName ||= driverNames.get(additional.transporterId) || '';
        }
        route.dispatchAssignment.driverName ||= route.driverName;
      }
      return reply.send({
        period: deliveryDate, capturedAt, source: 'Amazon Delivery Execution', live: !stale, stale,
        needsData: false, needsReauth: false, routeCount: routes.length,
        summary,
        routes,
        dispatchPlan,
        assignmentOptions: {
          drivers: activeDrivers,
          vans: (vans.items || []).map((item) => ({ id: String(item.id), label: item.licensePlate || item.vin || String(item.id), vin: item.vin || '', status: item.status })),
          phones: Array.from({ length: 50 }, (_, index) => ({ id: `phone-${String(index + 1).padStart(2, '0')}`, label: `Phone ${index + 1}` })),
        },
      });
    } catch (error) {
      logger?.warn?.({ err: error }, 'live route data unavailable');
      return reply.send(emptyLivePayload('The live Amazon route connection is unavailable. Reconnect Amazon and run a route sync.', true));
    }
  });

  app.put('/api/route-monitor/assignments', async (request, reply) => {
    if (!repository.saveDispatchRouteAssignment) return reply.code(501).send({ error: 'dispatch assignment storage is unavailable' });
    const body = request.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate || '') || !body.routeId || !body.routeCode) {
      return reply.code(400).send({ error: 'deliveryDate, routeId, and routeCode are required' });
    }
    const [routeResult, vans] = await Promise.all([
      repository.listLiveRoutes(request.tenantContext, { date: body.deliveryDate, limit: 500 }),
      repository.listVans(request.tenantContext, { limit: 500 })]);
    const driver = (routeResult.items || []).find((item) => String(item.transporterId) === String(body.driverId || '') && item.driverName);
    const van = (vans.items || []).find((item) => String(item.id) === String(body.vanId || ''));
    const phoneMatch = /^phone-(0[1-9]|[1-4]\d|50)$/.test(body.phoneId || '');
    if (body.driverId && !driver) return reply.code(400).send({ error: 'invalid driverId' });
    if (body.vanId && !van) return reply.code(400).send({ error: 'invalid vanId' });
    if (body.phoneId && !phoneMatch) return reply.code(400).send({ error: 'invalid phoneId' });
    try {
      const assignment = await repository.saveDispatchRouteAssignment(request.tenantContext, {
        deliveryDate: body.deliveryDate, routeId: String(body.routeId), routeCode: String(body.routeCode), transporterId: String(body.transporterId || ''),
        driverId: String(body.driverId || ''), driverName: driver?.driverName || '', vanId: String(body.vanId || ''),
        vanLabel: van?.licensePlate || van?.vin || '', vin: van?.vin || '', phoneId: String(body.phoneId || ''),
        phoneLabel: body.phoneId ? `Phone ${Number(String(body.phoneId).slice(-2))}` : '', pad: String(body.pad || '').slice(0, 40), stagingArea: String(body.stagingArea || '').slice(0, 40),
      });
      return reply.send({ deliveryDate: body.deliveryDate, routeId: body.routeId, transporterId: body.transporterId || '', assignment: assignment || {} });
    } catch (error) {
      const conflict = error?.code === '23505';
      logger?.warn?.({ err: error }, 'dispatch assignment save failed');
      return reply.code(conflict ? 409 : 400).send({ error: conflict ? 'That van or phone is already assigned to another route.' : error.message });
    }
  });

  app.put('/api/route-monitor/plan', async (request, reply) => {
    if (!repository.saveDispatchDayPlan) return reply.code(501).send({ error: 'dispatch plan storage is unavailable' });
    const body = request.body || {};
    const expectedRoutes = Number(body.expectedRoutes || 0); const sweepers = Number(body.sweepers || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate || '') || !Number.isInteger(expectedRoutes) || !Number.isInteger(sweepers) || expectedRoutes < 0 || expectedRoutes > 250 || sweepers < 0 || sweepers > 100) return reply.code(400).send({ error: 'invalid dispatch plan' });
    const dispatchPlan = await repository.saveDispatchDayPlan(request.tenantContext, { deliveryDate: body.deliveryDate, expectedRoutes, sweepers });
    return reply.send({ deliveryDate: body.deliveryDate, dispatchPlan });
  });

  app.get('/api/route-performance', async (_request, reply) => reply.send({
    period: null, routes: [], routeCount: 0, status: 'needs_data', needsData: true,
    source: 'No tenant-scoped Amazon route-performance connector artifact is available. Packaged snapshots are disabled.'
  }));
}
