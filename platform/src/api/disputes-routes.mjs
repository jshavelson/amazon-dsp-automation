/**
 * Disputes API Routes (extended)
 */

import { getDisputeCandidates } from '../services/scorecard-data-service.mjs';

export function disputesRoutes(app, { repository, registry, logger, referenceTenantSlug = 'jec-logistics' }) {

  /**
   * GET /api/disputes/candidates
   * Get dispute candidates - returns array for dashboard compatibility
   */
  app.get('/api/disputes/candidates', async (request, reply) => {
    const { tenantContext } = request;
    const { week } = request.query;
    if (tenantContext.principal.tenantId !== referenceTenantSlug) return reply.send([]);
    
    try {
      // Try to get real dispute candidates from weekly analysis
      const disputeData = await getDisputeCandidates(week);
      
      if (disputeData.disputes && disputeData.disputes.length > 0) {
        const candidates = disputeData.disputes.map((d, index) => ({
          driver_id: d.driverId || '',
          driver_name: d.driverName || d.title || '',
          metric: d.metric || 'DCR',
          reason: d.reason || d.details?.join(' ') || '',
          priority: d.priority || 'Medium',
          appealed_week: disputeData.week || week || null,
          submission_key: `dispute-${index + 1}`,
          tba_ids: d.tbaIds || [],
          appeal_details: d.details?.join(' ') || d.reason || '',
          confidence: d.confidence ?? null,
          evidence: d.evidence || ''
        }));
        
        return reply.send(candidates);
      }
      
      return reply.send([]);
    } catch (error) {
      logger.error('Failed to get dispute candidates:', error);
      return reply.code(500).send({ error: 'Failed to get dispute candidates' });
    }
  });

  /**
   * GET /api/disputes
   * Get all disputes - returns array for dashboard compatibility
   */
  app.get('/api/disputes', async (request, reply) => {
    const { tenantContext } = request;
    if (tenantContext.principal.tenantId !== referenceTenantSlug) return reply.send([]);
    
    try {
      // Try to get real disputes from database
      const cases = await repository.listCases(tenantContext, 'disputes', 100);
      
      if (cases && cases.length > 0) {
        const disputes = cases.map(c => ({
          id: c.id,
          driver_id: c.external_key || c.id,
          driver_name: c.external_key || c.id,
          metric: 'DCR',
          week: c.period_key || null,
          status: c.status,
          submission_date: c.created_at,
          confirmation_number: c.id,
          outcome: c.status,
          evidence: c.summary || ''
        }));
        
        return reply.send(disputes);
      }
      
      return reply.send([]);
    } catch (error) {
      logger.error('Failed to get disputes:', error);
      return reply.code(500).send({ error: 'Failed to get disputes' });
    }
  });
}
