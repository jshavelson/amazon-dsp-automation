/**
 * Driver Performance API Routes
 */

import { getDriverPerformance } from '../services/scorecard-data-service.mjs';

export function driverPerformanceRoutes(app, { repository, logger, referenceTenantSlug = 'jec-logistics' }) {

  /**
   * GET /api/driver-performance
   * Get driver performance data - returns array format for dashboard compatibility
   */
  app.get('/api/driver-performance', async (request, reply) => {
    const { tenantContext } = request;
    const { week } = request.query;
    if (tenantContext.principal.tenantId !== referenceTenantSlug) return reply.send([]);
    
    try {
      // Try to get real data from scorecard files
      const data = await getDriverPerformance(week);
      
      if (data.drivers && data.drivers.length > 0) {
        // Format data for dashboard compatibility
        const performance = data.drivers.map(d => ({
          driver_id: d.id,
          driver_name: d.name,
          transporter_id: d.id,
          score: d.overallScore || d.score || 0,
          overall_standing: d.overallStanding || null,
          dcr: d.dcr || 0,
          dcr_tier: d.dcrTier || null,
          pod: d.pod || 0,
          pod_tier: d.podTier || null,
          cdf: d.cdf || 0,
          cdf_tier: d.cdfTier || null,
          dsb: d.dsb || 0,
          dsb_tier: d.dsbTier || null,
          psb: d.psb || 0,
          psb_tier: d.psbTier || null,
          packages_delivered: d.packagesDelivered || 0,
          safety_events: 0,
          status: d.status || 'active',
          week: data.week || week || null
        }));
        
        return reply.send(performance);
      }
      
      // A workforce roster is not performance evidence. Never synthesize
      // scorecard metrics when Amazon has not delivered the requested week.
      return reply.send([]);
    } catch (error) {
      logger.error('Failed to get driver performance:', error);
      return reply.code(500).send({ error: 'Failed to get driver performance' });
    }
  });
}
