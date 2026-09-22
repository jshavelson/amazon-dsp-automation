import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERFORMANCE_SNAPSHOT = path.resolve(HERE, '..', '..', 'operational-snapshots', 'route-monitor.json');
const emptyLivePayload = (message, needsReauth = false) => ({
  period: null, capturedAt: null, source: 'Amazon Delivery Execution', live: false, stale: true,
  needsData: true, needsReauth, message, routeCount: 0,
  summary: { assigned: 0, inProgress: 0, completed: 0, behind: 0, stalled: 0, lateDepartures: 0, multiRoute: 0 },
  routes: [],
});

export function routeMonitorRoutes(app, { repository, logger, referenceTenantSlug = 'jec-logistics' }) {
  app.get('/api/route-monitor', async (request, reply) => {
    try {
      const result = await repository.listLiveRoutes(request.tenantContext, {
        date: request.query.date, limit: Math.min(Number(request.query.limit) || 250, 500),
      });
      if (!result.items?.length) return reply.send(emptyLivePayload('No same-day route execution snapshot has been ingested for this tenant.'));
      const routes = result.items;
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
      const [drivers, vans, assignments] = await Promise.all([
        repository.listDrivers?.(request.tenantContext, { limit: 500 }) || { items: [] },
        repository.listVans?.(request.tenantContext, { limit: 500 }) || { items: [] },
        repository.listDispatchRouteAssignments?.(request.tenantContext, deliveryDate) || [],
      ]);
      const assignmentByRoute = new Map(assignments.map((item) => [`${item.routeId}|${item.transporterId || ''}`, item]));
      for (const route of routes) route.dispatchAssignment = assignmentByRoute.get(`${route.routeId}|${route.transporterId || ''}`) || {};
      return reply.send({
        period: deliveryDate, capturedAt, source: 'Amazon Delivery Execution', live: !stale, stale,
        needsData: false, needsReauth: false, routeCount: routes.length,
        summary,
        routes,
        assignmentOptions: {
          drivers: (drivers.items || []).map((item) => ({ id: String(item.id), label: item.name || String(item.id), status: item.status, source: 'Driver roster' })),
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate || '') || !body.routeId) {
      return reply.code(400).send({ error: 'deliveryDate and routeId are required' });
    }
    const [drivers, vans] = await Promise.all([
      repository.listDrivers(request.tenantContext, { limit: 500 }),
      repository.listVans(request.tenantContext, { limit: 500 }),
    ]);
    const driver = (drivers.items || []).find((item) => String(item.id) === String(body.driverId || ''));
    const van = (vans.items || []).find((item) => String(item.id) === String(body.vanId || ''));
    const phoneMatch = /^phone-(0[1-9]|[1-4]\d|50)$/.test(body.phoneId || '');
    if (body.driverId && !driver) return reply.code(400).send({ error: 'invalid driverId' });
    if (body.vanId && !van) return reply.code(400).send({ error: 'invalid vanId' });
    if (body.phoneId && !phoneMatch) return reply.code(400).send({ error: 'invalid phoneId' });
    try {
      const assignment = await repository.saveDispatchRouteAssignment(request.tenantContext, {
        deliveryDate: body.deliveryDate, routeId: String(body.routeId), transporterId: String(body.transporterId || ''),
        driverId: String(body.driverId || ''), driverName: driver?.name || '', vanId: String(body.vanId || ''),
        vanLabel: van?.licensePlate || van?.vin || '', vin: van?.vin || '', phoneId: String(body.phoneId || ''),
        phoneLabel: body.phoneId ? `Phone ${Number(String(body.phoneId).slice(-2))}` : '',
      });
      return reply.send({ deliveryDate: body.deliveryDate, routeId: body.routeId, transporterId: body.transporterId || '', assignment: assignment || {} });
    } catch (error) {
      const conflict = error?.code === '23505';
      logger?.warn?.({ err: error }, 'dispatch assignment save failed');
      return reply.code(conflict ? 409 : 400).send({ error: conflict ? 'That van or phone is already assigned to another route.' : error.message });
    }
  });

  app.get('/api/route-performance', async (request, reply) => {
    if (request.tenantContext.principal.tenantId !== referenceTenantSlug) {
      return reply.send({ period: null, routes: [], routeCount: 0, source: 'No tenant-scoped route performance source available', needsData: true });
    }
    try { return reply.send(JSON.parse(await fs.readFile(PERFORMANCE_SNAPSHOT, 'utf8'))); }
    catch (error) {
      logger?.error?.({ err: error }, 'weekly route performance snapshot unavailable');
      return reply.send({ period: null, routes: [], routeCount: 0, source: 'No weekly scorecard source available', needsData: true });
    }
  });
}
