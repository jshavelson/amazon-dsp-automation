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

export function routeMonitorRoutes(app, { repository, logger }) {
  app.get('/api/route-monitor', async (request, reply) => {
    try {
      const result = await repository.listLiveRoutes(request.tenantContext, {
        date: request.query.date, limit: Math.min(Number(request.query.limit) || 250, 500),
      });
      if (!result.items?.length) return reply.send(emptyLivePayload('No same-day route execution snapshot has been ingested for this tenant.'));
      const routes = result.items;
      const capturedAt = routes.reduce((latest, row) => !latest || row.capturedAt > latest ? row.capturedAt : latest, null);
      const stale = Date.now() - Date.parse(capturedAt) > 15 * 60 * 1000;
      const count = (predicate) => routes.filter(predicate).length;
      return reply.send({
        period: routes[0].deliveryDate, capturedAt, source: 'Amazon Delivery Execution', live: !stale, stale,
        needsData: false, needsReauth: false, routeCount: routes.length,
        summary: {
          assigned: count((row) => row.status === 'assigned'), inProgress: count((row) => row.status === 'in_progress'),
          completed: count((row) => row.status === 'completed'), behind: count((row) => row.risk === 'behind'),
          stalled: count((row) => row.risk === 'stalled'), lateDepartures: count((row) => row.risk === 'late_departure'),
          multiRoute: count((row) => row.isMultiRoute),
        },
        routes,
      });
    } catch (error) {
      logger?.warn?.({ err: error }, 'live route data unavailable');
      return reply.send(emptyLivePayload('The live Amazon route connection is unavailable. Reconnect Amazon and run a route sync.', true));
    }
  });

  app.get('/api/route-performance', async (_request, reply) => {
    try { return reply.send(JSON.parse(await fs.readFile(PERFORMANCE_SNAPSHOT, 'utf8'))); }
    catch (error) {
      logger?.error?.({ err: error }, 'weekly route performance snapshot unavailable');
      return reply.send({ period: null, routes: [], routeCount: 0, source: 'No weekly scorecard source available', needsData: true });
    }
  });
}
