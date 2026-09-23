/**
 * PAVE integration boundary. PAVE facts must come from an ingested tenant
 * source; unavailable facts are never synthesized.
 */
export class PaveService {
  constructor({ repository, logger = console }) {
    this.repository = repository;
    this.logger = logger;
  }

  async listVehicles(context, { skip = 0, limit = 100 } = {}) {
    const vans = await this.repository.listVans(context, { skip, limit });
    const items = (vans.items || []).map((van) => ({
      id: van.id, vin: van.vin, licensePlate: van.licensePlate, make: van.make,
      model: van.model, year: van.year, type: van.type, ownership: van.ownership,
      homeStationId: van.homeStationId, paveId: null, paveStatus: null,
      lastPaveInspectionDate: null, nextPaveInspectionDue: null, paveScore: null,
      complianceStatus: 'needs_data', exteriorCondition: null,
      interiorCondition: null, mechanicalCondition: null, lastMaintenanceDate: null,
      nextMaintenanceDue: null, maintenanceCostYTD: null, repairCostYTD: null,
      hasOpenRecalls: null, recallCount: null, hasSafetyIssues: null,
      safetyIssueCount: null, syncedAt: null
    }));
    return {
      items, total: Number(vans.total ?? items.length),
      page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit,
      needsData: true, source: 'PAVE',
      message: 'PAVE inspections have not been ingested for this tenant'
    };
  }

  async getVehicleByVin(context, vin) {
    const vehicles = await this.listVehicles(context, { skip: 0, limit: 1000 });
    return vehicles.items.find((vehicle) => vehicle.vin === vin) || null;
  }

  async listInspections(_context, { skip = 0, limit = 100 } = {}) {
    return { items: [], total: 0, page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit, needsData: true, source: 'PAVE', message: 'No PAVE inspections have been ingested' };
  }

  async getComplianceReport(context, { period = 'current' } = {}) {
    const vehicles = await this.listVehicles(context, { skip: 0, limit: 1000 });
    return { report: {
      reportId: null, generatedAt: null, period, totalVehicles: vehicles.total,
      compliantVehicles: null, nonCompliantVehicles: null, complianceRate: null,
      vehicles: [], summary: { byStatus: {}, bySeverity: {}, byCategory: {}, topIssues: [] },
      recommendations: [], needsData: true, source: 'PAVE',
      message: 'No PAVE compliance report has been ingested'
    } };
  }

  async getWearAndTear(_context, _vin) { return null; }

  async listMaintenance(_context, { skip = 0, limit = 100 } = {}) {
    return { items: [], total: 0, page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit, needsData: true, source: 'PAVE', message: 'No PAVE maintenance records have been ingested' };
  }

  async syncPaveData() {
    return { synced: 0, failed: 0, needsData: true, message: 'PAVE connector is not configured; no data was changed' };
  }

  async getWearAndTearGuidelines() {
    const empty = { acceptable: [], unacceptable: [], scoringCriteria: [] };
    return { source: 'PAVE policy source not configured', needsConfiguration: true, exterior: empty, interior: empty, mechanical: empty };
  }
}

export default PaveService;
