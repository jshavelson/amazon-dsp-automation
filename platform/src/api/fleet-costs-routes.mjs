/**
 * Fleet Costs API Routes
 */

import { getFleetData } from '../services/scorecard-data-service.mjs';

export function fleetCostsRoutes(app, { repository, logger }) {

  /**
   * GET /api/fleet-costs
   * Get fleet costs data
   */
  app.get('/api/fleet-costs', async (request, reply) => {
    const { tenantContext } = request;
    
    try {
      // Get real fleet data from vehicles file
      const fleetVehicles = await getFleetData();
      
      // Get vans from database
      const vans = await repository.listVans(tenantContext, { limit: 100 });
      
      // Use real fleet data if available
      const actualVans = fleetVehicles.length > 0 ? fleetVehicles : vans.items;
      
      // Calculate ownership breakdown from real data
      const ownershipBreakdown = {
        AMAZON_OWNED: actualVans.filter(v => v.ownership === 'Amazon Owned').length,
        AMAZON_RENTAL: actualVans.filter(v => v.ownership === 'Amazon LMR').length,
        RENTAL: actualVans.filter(v => v.ownership === 'Rental').length,
        DSP_LEASE: actualVans.filter(v => v.ownership === 'DSP Lease').length
      };
      
      const totalVans = actualVans.length;
      const operationalVans = actualVans.filter(v => v.status === 'active').length;
      const groundedVans = totalVans - operationalVans;
      
      const costByType = {
        fuel: 25000,
        maintenance: 12000,
        insurance: 8000,
        depreciation: 5000,
        other: 5000
      };
      
      const monthlyTrend = [
        { month: '2026-06-01', total_cost: 42000 },
        { month: '2026-07-01', total_cost: 45000 },
        { month: '2026-08-01', total_cost: 48000 },
        { month: '2026-09-01', total_cost: 50000 }
      ];
      
      const fleetVans = actualVans.map(van => ({
        id: van.id || van.vin,
        vin: van.vin,
        licensePlate: van.licensePlate || van.license_plate,
        make: van.make,
        model: van.model,
        year: van.year,
        ownership: van.ownership,
        status: van.status,
        monthly_cost: Math.floor(500 + Math.random() * 2000),
        cost_per_mile: 0.5 + Math.random() * 0.5
      }));
      
      const totalCost = 50000;
      
      return reply.send({
        total_cost: totalCost,
        cost_change_percent: 5.0,
        cost_per_mile: 0.75,
        total_vans: totalVans,
        operational_vans: operationalVans,
        grounded_vans: groundedVans,
        cost_per_van: totalCost / totalVans,
        ownership_breakdown: [
          { type: 'amazon_owned', count: ownershipBreakdown.AMAZON_OWNED, total_cost: 15000 },
          { type: 'amazon_lmr', count: ownershipBreakdown.AMAZON_RENTAL, total_cost: 12000 },
          { type: 'rental', count: ownershipBreakdown.RENTAL, total_cost: 8000 },
          { type: 'lease', count: ownershipBreakdown.DSP_LEASE, total_cost: 2000 }
        ],
        cost_by_type: Object.entries(costByType).map(([type, cost]) => ({ type, ...cost })),
        monthly_trend: monthlyTrend,
        vans: fleetVans
      });
    } catch (error) {
      logger.error('Failed to get fleet costs:', error);
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
