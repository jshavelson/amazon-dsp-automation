/**
 * Route Monitor API Routes
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_SNAPSHOT = path.resolve(HERE, '..', '..', 'operational-snapshots', 'route-monitor.json');

async function packagedRoutes() {
  return JSON.parse(await fs.readFile(ROUTE_SNAPSHOT, 'utf8'));
}

export function routeMonitorRoutes(app, { repository, logger }) {

  /**
   * GET /api/route-monitor
   * Get route monitoring data - returns array for dashboard compatibility
   */
  app.get('/api/route-monitor', async (request, reply) => {
    const { tenantContext } = request;
    const { date } = request.query;
    
    try {
      const database = await repository.listRoutes(tenantContext, { date, limit: 100 });
      if (database.items?.length) {
        const routes = database.items.map(r => ({
          route_code: r.id,
          driver_id: r.driverId,
          driver_name: '',
          van_id: r.vanId,
          van_vin: '',
          stops: r.currentStop || r.totalStops || 0,
          total_stops: r.totalStops || 50,
          status: r.status?.toUpperCase() || 'IN_PROGRESS',
          start_time: r.startTime || '',
          end_time: r.endTime || '',
          eta: '',
          delay_minutes: 0,
          completion_pct: r.status === 'completed' ? 100 : null,
          packages_delivered: r.packagesDelivered || 0,
          packages_total: r.packagesTotal || 0,
          miles_driven: r.milesDriven || 0,
          on_time: r.onTime || true,
          delay_reason: ''
        }));
        
        return reply.send({ period: date || routes[0]?.date || null, routes, routeCount: routes.length, source: 'Amazon route assignments', needsData: false });
      }
      const snapshot = await packagedRoutes();
      return reply.send(snapshot);
    } catch (error) {
      logger?.warn?.({ err: error }, 'route database unavailable; using packaged route snapshot');
      try { return reply.send(await packagedRoutes()); }
      catch (snapshotError) {
        logger?.error?.({ err: snapshotError }, 'route snapshot unavailable');
        return reply.send({ period: null, routes: [], routeCount: 0, source: 'No route source available', needsData: true });
      }
    }
  });
}
