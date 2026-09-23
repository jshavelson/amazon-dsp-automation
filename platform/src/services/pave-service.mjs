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
    const assessments = this.repository.listLatestPaveAssessments
      ? await this.repository.listLatestPaveAssessments(context, { skip: 0, limit: 5000 })
      : { items: [], total: 0 };
    const byVin = new Map(assessments.items.map((item) => [item.vin, item]));
    const items = (vans.items || []).map((van) => {
      const assessment = byVin.get(van.vin);
      return {
        id: van.id, vin: van.vin, licensePlate: van.licensePlate, make: van.make,
        model: van.model, year: van.year, type: van.type, ownership: van.ownership,
        homeStationId: van.homeStationId, paveId: assessment?.id || null, paveStatus: assessment?.status || null,
        lastPaveInspectionDate: assessment?.assessedAt || null, nextPaveInspectionDue: null, paveScore: assessment?.conditionScore ?? null,
        complianceStatus: !assessment ? 'needs_data' : assessment.groundingRisk || (assessment.grade || 0) < 3 ? 'non_compliant' : 'compliant',
        exteriorCondition: assessment?.gradeLabel || null,
        interiorCondition: null, mechanicalCondition: null, lastMaintenanceDate: null,
        nextMaintenanceDue: null, maintenanceCostYTD: null, repairCostYTD: null,
        hasOpenRecalls: null, recallCount: null, hasSafetyIssues: assessment?.groundingRisk ?? null,
        safetyIssueCount: assessment?.groundingRisk ? 1 : 0, syncedAt: assessment?.assessedAt || null
      };
    });
    return {
      items, total: Number(vans.total ?? items.length),
      page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit,
      needsData: assessments.total === 0, source: 'PAVE Fleet Dashboard',
      message: assessments.total ? null : 'PAVE inspections have not been ingested for this tenant'
    };
  }

  async getVehicleByVin(context, vin) {
    const vehicles = await this.listVehicles(context, { skip: 0, limit: 1000 });
    return vehicles.items.find((vehicle) => vehicle.vin === vin) || null;
  }

  async listInspections(context, { vin = null, skip = 0, limit = 100 } = {}) {
    if (!this.repository.listPaveAssessmentHistory) return { items: [], total: 0, page: 0, pageSize: limit, needsData: true, source: 'PAVE Fleet Dashboard' };
    const result = await this.repository.listPaveAssessmentHistory(context, { vin, skip, limit });
    return { ...result, page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit, needsData: result.total === 0, source: 'PAVE Fleet Dashboard' };
  }

  async getComplianceReport(context, { period = 'current' } = {}) {
    const vehicles = await this.listVehicles(context, { skip: 0, limit: 1000 });
    const assessed = vehicles.items.filter((vehicle) => vehicle.complianceStatus !== 'needs_data');
    const compliant = assessed.filter((vehicle) => vehicle.complianceStatus === 'compliant').length;
    const nonCompliant = assessed.length - compliant;
    return { report: {
      reportId: null, generatedAt: assessed.map((item) => item.syncedAt).filter(Boolean).sort().at(-1) || null, period, totalVehicles: vehicles.total,
      compliantVehicles: assessed.length ? compliant : null, nonCompliantVehicles: assessed.length ? nonCompliant : null,
      complianceRate: assessed.length ? compliant / assessed.length * 100 : null,
      vehicles: vehicles.items, summary: { byStatus: { compliant, nonCompliant, needsData: vehicles.total - assessed.length }, bySeverity: {}, byCategory: {}, topIssues: [] },
      recommendations: nonCompliant ? ['Review PAVE grounding risks and condition grades below Fair.'] : [], needsData: assessed.length === 0, source: 'PAVE Fleet Dashboard',
      message: assessed.length ? null : 'No PAVE compliance report has been ingested'
    } };
  }

  async getWearAndTear(context, vin) {
    if (!this.repository.listPaveAssessmentHistory) return null;
    const result = await this.repository.listPaveAssessmentHistory(context, { vin, limit: 1, skip: 0 });
    return result.items[0] || null;
  }

  async listMaintenance(_context, { skip = 0, limit = 100 } = {}) {
    return { items: [], total: 0, page: Math.floor(skip / Math.max(limit, 1)), pageSize: limit, needsData: true, source: 'PAVE', message: 'No PAVE maintenance records have been ingested' };
  }

  async syncPaveData() {
    return { synced: 0, failed: 0, queued: false, message: 'Managed PAVE exports run after the scheduled authentication canary; reconnect the source if attention is required.' };
  }

  async getWearAndTearGuidelines() {
    const empty = { acceptable: [], unacceptable: [], scoringCriteria: [] };
    return { source: 'PAVE policy source not configured', needsConfiguration: true, exterior: empty, interior: empty, mechanical: empty };
  }
}

export default PaveService;
