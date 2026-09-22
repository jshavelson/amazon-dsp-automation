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
          appealed_week: week || '2026-wk37',
          submission_key: `dispute-${index + 1}`,
          tba_ids: d.tbaIds || [],
          appeal_details: d.details?.join(' ') || d.reason || '',
          confidence: d.confidence || 0.85,
          evidence: d.evidence || 'Scorecard data, route logs'
        }));
        
        return reply.send(candidates);
      }
      
      // Fallback to mock dispute candidates
      const candidates = [
        {
          driver_id: 'A11030SMNGIQYH',
          driver_name: 'Jayden Julius Tavera',
          metric: 'DCR',
          reason: 'Business closed - no access',
          priority: 'High',
          appealed_week: week || '2026-wk37',
          submission_key: 'dcr-business-closed-001',
          tba_ids: ['TBA123456', 'TBA789012'],
          appeal_details: 'Store was closed at time of delivery, customer confirmed',
          confidence: 0.95,
          evidence: 'GPS logs, customer confirmation'
        },
        {
          driver_id: 'A2DWYPL507YLX0',
          driver_name: 'Danjay Steve Blackburn',
          metric: 'POD',
          reason: 'GPS tracking error',
          priority: 'Medium',
          appealed_week: week || '2026-wk37',
          submission_key: 'pod-gps-error-002',
          tba_ids: ['TBA234567'],
          appeal_details: 'GPS showed at location but marked as missed',
          confidence: 0.85,
          evidence: 'GPS breadcrumb trail, delivery confirmation photo'
        },
        {
          driver_id: 'A33SU2XRPGI1M5',
          driver_name: 'Demaury Juvar Brown',
          metric: 'CDF',
          reason: 'Customer not available',
          priority: 'Low',
          appealed_week: week || '2026-wk37',
          submission_key: 'cdf-not-available-003',
          tba_ids: ['TBA345678', 'TBA456789', 'TBA567890'],
          appeal_details: 'Customer was not home, left notice',
          confidence: 0.75,
          evidence: 'Door camera footage, notice left photo'
        }
      ];
       
      return reply.send(candidates);
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
          week: c.period_key || '2026-wk37',
          status: c.status,
          submission_date: c.created_at,
          confirmation_number: c.id,
          outcome: c.status,
          evidence: c.summary || ''
        }));
        
        return reply.send(disputes);
      }
      
      // Fallback to mock disputes
      const disputes = [
        {
          id: 'DIS-001',
          driver_id: 'A11030SMNGIQYH',
          driver_name: 'Jayden Julius Tavera',
          metric: 'DCR',
          week: '2026-wk36',
          status: 'submitted',
          submission_date: '2026-09-15',
          confirmation_number: 'AMZN-123456789',
          outcome: 'pending',
          evidence: 'GPS logs, customer confirmation'
        },
        {
          id: 'DIS-002',
          driver_id: 'A2DWYPL507YLX0',
          driver_name: 'Danjay Steve Blackburn',
          metric: 'POD',
          week: '2026-wk35',
          status: 'approved',
          submission_date: '2026-09-10',
          confirmation_number: 'AMZN-987654321',
          outcome: 'approved',
          evidence: 'GPS breadcrumb trail, delivery confirmation photo'
        }
      ];
      
      return reply.send(disputes);
    } catch (error) {
      logger.error('Failed to get disputes:', error);
      return reply.code(500).send({ error: 'Failed to get disputes' });
    }
  });
}
