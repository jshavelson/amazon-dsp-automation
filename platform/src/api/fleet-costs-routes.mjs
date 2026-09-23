/**
 * Fleet Costs API Routes
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFleetData } from '../services/scorecard-data-service.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLEET_COST_SNAPSHOT = path.resolve(HERE, '..', '..', 'operational-snapshots', 'fleet-costs.json');

async function reviewedFleetCosts() {
  return JSON.parse(await fs.readFile(FLEET_COST_SNAPSHOT, 'utf8'));
}

export function fleetCostsRoutes(app, { repository, logger, referenceTenantSlug = 'jec-logistics' }) {

  /**
   * GET /api/fleet-costs
   * Get fleet costs data
   */
  app.get('/api/fleet-costs', async (request, reply) => {
    if (request.tenantContext.principal.tenantId !== referenceTenantSlug) {
      return reply.send({
        asOf: null, period: null, needsData: true,
        message: 'Connect Digits or confirm an accounting upload for expenses, and connect Amazon Cortex Payments for reimbursement coverage.',
        accountingSource: null, paymentsSource: null, months: [], charges: [], summary: {}, dataSources: []
      });
    }
    try {
      return reply.send(await reviewedFleetCosts());
    } catch (error) {
      logger.error({ err: error }, 'Failed to load reviewed fleet costs snapshot');
      return reply.code(500).send({ error: 'Failed to get fleet costs' });
    }
  });

  /**
   * GET /api/fleet-optimization
   * Get fleet optimization data - formatted for dashboard compatibility
   */
  app.get('/api/fleet-optimization', async (request, reply) => {
    const { tenantContext } = request;
    
    try {
      const fleetVehicles = await getFleetData();
      const vans = await repository.listVans(tenantContext, { limit: 100 });
      
      const actualVans = fleetVehicles.length > 0 ? fleetVehicles : vans.items;
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
        optimization_recommendations: [
          { type: 'retire', van_id: 'EDV-15', reason: 'Window/electrical issue - towed to service center', savings: 5000 },
          { type: 'replace', van_id: 'EDV-16', reason: 'Lap-belt misuse - route disabled', savings: 3000 }
        ]
      });
    } catch (error) {
      logger.error('Failed to get fleet optimization:', error);
      return reply.code(500).send({ error: 'Failed to get fleet optimization' });
    }
  });
}
