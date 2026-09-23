/**
 * Fleet Costs API Routes
 */

export function fleetCostsRoutes(app, { repository, logger }) {

  /**
   * GET /api/fleet-costs
   * Get fleet costs data
   */
  app.get('/api/fleet-costs', async (request, reply) => {
    return reply.send({
      asOf: null, period: null, needsData: true, status: 'needs_data',
      message: 'Live Fleet Costs requires tenant-scoped Digits/accounting charges and Amazon Payments coverage. Packaged reconciliation snapshots are disabled.',
      accountingSource: null, paymentsSource: null, months: [], vendors: [], amazonClasses: [],
      invoiceBridge: [], charges: [], notes: [], caveats: [], summary: {}, dataSources: []
    });
  });

  /**
   * GET /api/fleet-optimization
   * Get fleet optimization data - formatted for dashboard compatibility
   */
  app.get('/api/fleet-optimization', async (request, reply) => {
    const { tenantContext } = request;
    
    try {
      const vans = await repository.listVans(tenantContext, { limit: 100 });
      const actualVans = vans.items;
      const totalVans = actualVans.length;
      const operational = actualVans.filter(v => v.status === 'active').length;
      const grounded = totalVans - operational;
      
      return reply.send({
        total_vans: totalVans,
        operational: operational,
        grounded: grounded,
        ownership: {
          AMAZON_OWNED: actualVans.filter(v => v.ownership === 'Amazon Owned').length,
          AMAZON_RENTAL: actualVans.filter(v => v.ownership === 'Amazon LMR').length,
          RENTAL: actualVans.filter(v => v.ownership === 'Rental').length,
          DSP_LEASE: actualVans.filter(v => v.ownership === 'DSP Lease').length
        },
        optimization_recommendations: [],
        needsData: actualVans.length === 0,
        source: 'tenant_database'
      });
    } catch (error) {
      logger.error('Failed to get fleet optimization:', error);
      return reply.code(500).send({ error: 'Failed to get fleet optimization' });
    }
  });
}
