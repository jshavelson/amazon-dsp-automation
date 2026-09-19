/**
 * PAVE API Routes
 * 
 * Routes for PAVE (Preventive Maintenance and Vehicle Evaluation) integration.
 */

import { PaveService } from '../services/pave-service.mjs';

export function paveRoutes(app, { repository, logger }) {
  const paveService = new PaveService({ repository, logger });

  /**
   * GET /api/pave/vehicles
   * Get all PAVE vehicles
   */
  app.get('/api/pave/vehicles', async (request, reply) => {
    const { tenantContext } = request;
    const { skip = 0, limit = 100 } = request.query;
    
    try {
      const result = await paveService.listVehicles(tenantContext, { skip: Number(skip), limit: Number(limit) });
      return reply.send(result);
    } catch (error) {
      logger.error('Failed to get PAVE vehicles:', error);
      return reply.code(500).send({ error: 'Failed to get PAVE vehicles' });
    }
  });

  /**
   * GET /api/pave/vehicles/:vin
   * Get a PAVE vehicle by VIN
   */
  app.get('/api/pave/vehicles/:vin', async (request, reply) => {
    const { tenantContext } = request;
    const { vin } = request.params;
    
    try {
      const vehicle = await paveService.getVehicleByVin(tenantContext, vin);
      if (!vehicle) {
        return reply.code(404).send({ error: `PAVE vehicle with VIN ${vin} not found` });
      }
      return reply.send(vehicle);
    } catch (error) {
      logger.error(`Failed to get PAVE vehicle ${vin}:`, error);
      return reply.code(500).send({ error: `Failed to get PAVE vehicle ${vin}` });
    }
  });

  /**
   * GET /api/pave/inspections
   * Get PAVE inspections
   */
  app.get('/api/pave/inspections', async (request, reply) => {
    const { tenantContext } = request;
    const { vin, startDate, endDate, skip = 0, limit = 100 } = request.query;
    
    try {
      const result = await paveService.listInspections(tenantContext, {
        vin,
        startDate,
        endDate,
        skip: Number(skip),
        limit: Number(limit)
      });
      return reply.send(result);
    } catch (error) {
      logger.error('Failed to get PAVE inspections:', error);
      return reply.code(500).send({ error: 'Failed to get PAVE inspections' });
    }
  });

  /**
   * GET /api/pave/compliance/report
   * Get PAVE compliance report
   */
  app.get('/api/pave/compliance/report', async (request, reply) => {
    const { tenantContext } = request;
    const { period = 'current' } = request.query;
    
    try {
      const result = await paveService.getComplianceReport(tenantContext, { period });
      return reply.send(result);
    } catch (error) {
      logger.error('Failed to get PAVE compliance report:', error);
      return reply.code(500).send({ error: 'Failed to get PAVE compliance report' });
    }
  });

  /**
   * GET /api/pave/wear-and-tear
   * Get wear and tear assessment for a vehicle
   */
  app.get('/api/pave/wear-and-tear', async (request, reply) => {
    const { tenantContext } = request;
    const { vin } = request.query;
    
    if (!vin) {
      return reply.code(400).send({ error: 'VIN parameter is required' });
    }
    
    try {
      const result = await paveService.getWearAndTear(tenantContext, vin);
      if (!result) {
        return reply.code(404).send({ error: `Wear and tear assessment for VIN ${vin} not found` });
      }
      return reply.send(result);
    } catch (error) {
      logger.error(`Failed to get wear and tear for ${vin}:`, error);
      return reply.code(500).send({ error: `Failed to get wear and tear for ${vin}` });
    }
  });

  /**
   * GET /api/pave/maintenance
   * Get PAVE maintenance records
   */
  app.get('/api/pave/maintenance', async (request, reply) => {
    const { tenantContext } = request;
    const { vin, startDate, endDate, skip = 0, limit = 100 } = request.query;
    
    try {
      const result = await paveService.listMaintenance(tenantContext, {
        vin,
        startDate,
        endDate,
        skip: Number(skip),
        limit: Number(limit)
      });
      return reply.send(result);
    } catch (error) {
      logger.error('Failed to get PAVE maintenance:', error);
      return reply.code(500).send({ error: 'Failed to get PAVE maintenance' });
    }
  });

  /**
   * POST /api/pave/sync
   * Sync PAVE data with local database
   */
  app.post('/api/pave/sync', async (request, reply) => {
    const { tenantContext } = request;
    
    try {
      const result = await paveService.syncPaveData(tenantContext);
      return reply.send(result);
    } catch (error) {
      logger.error('Failed to sync PAVE data:', error);
      return reply.code(500).send({ error: 'Failed to sync PAVE data' });
    }
  });

  /**
   * GET /api/pave/guidelines
   * Get wear and tear guidelines
   */
  app.get('/api/pave/guidelines', async (request, reply) => {
    const { tenantContext } = request;
    
    try {
      const guidelines = await paveService.getWearAndTearGuidelines(tenantContext);
      return reply.send(guidelines);
    } catch (error) {
      logger.error('Failed to get wear and tear guidelines:', error);
      return reply.code(500).send({ error: 'Failed to get wear and tear guidelines' });
    }
  });
}
