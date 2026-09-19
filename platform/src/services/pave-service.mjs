/**
 * PAVE (Preventive Maintenance and Vehicle Evaluation) Service
 * 
 * This service provides integration with the PAVE system for fleet compliance
 * and wear & tear analysis.
 */

import { randomUUID } from 'node:crypto';

/**
 * PAVE Service for fleet compliance and wear & tear analysis
 */
export class PaveService {
  constructor({ repository, logger = console }) {
    this.repository = repository;
    this.logger = logger;
  }

  /**
   * Get all PAVE vehicles for a tenant
   */
  async listVehicles(context, { skip = 0, limit = 100 } = {}) {
    const { tenantId } = context;
    
    // In production, this would query the PAVE API
    // For now, return mock data based on existing vans
    const vans = await this.repository.listVans(context, { skip: 0, limit: 1000 });
    
    // Map vans to PAVE vehicle format
    const paveVehicles = vans.items.map(van => ({
      id: `pave-${van.id}`,
      vin: van.vin,
      licensePlate: van.licensePlate,
      make: van.make,
      model: van.model,
      year: van.year,
      type: van.type,
      ownership: van.ownership,
      homeStationId: van.homeStationId,
      paveId: `PAVE-${van.vin}`,
      paveStatus: this._getRandomPaveStatus(),
      lastPaveInspectionDate: this._randomDateWithinDays(30),
      nextPaveInspectionDue: this._randomFutureDate(30),
      paveScore: Math.floor(Math.random() * 40) + 60, // 60-100
      complianceStatus: Math.random() > 0.2 ? 'compliant' : 'non_compliant',
      exteriorCondition: this._getRandomCondition(),
      interiorCondition: this._getRandomCondition(),
      mechanicalCondition: this._getRandomCondition(),
      lastMaintenanceDate: this._randomDateWithinDays(90),
      nextMaintenanceDue: this._randomFutureDate(60),
      maintenanceCostYTD: Math.floor(Math.random() * 5000),
      repairCostYTD: Math.floor(Math.random() * 2000),
      hasOpenRecalls: Math.random() > 0.8,
      recallCount: Math.random() > 0.8 ? 0 : Math.floor(Math.random() * 3) + 1,
      hasSafetyIssues: Math.random() > 0.9,
      safetyIssueCount: Math.random() > 0.9 ? 0 : Math.floor(Math.random() * 2) + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString()
    }));
    
    return {
      items: paveVehicles,
      total: paveVehicles.length,
      page: 0,
      pageSize: paveVehicles.length
    };
  }

  /**
   * Get a PAVE vehicle by VIN
   */
  async getVehicleByVin(context, vin) {
    const vehicles = await this.listVehicles(context);
    return vehicles.items.find(v => v.vin === vin) || null;
  }

  /**
   * Get PAVE inspections for a vehicle
   */
  async listInspections(context, { vin, startDate, endDate, skip = 0, limit = 100 } = {}) {
    const { tenantId } = context;
    
    // Generate mock inspection data
    const inspections = [];
    const count = Math.floor(Math.random() * 5) + 1;
    
    for (let i = 0; i < count; i++) {
      inspections.push({
        id: `inspection-${randomUUID()}`,
        vehicleId: `pave-${vin}`,
        vin,
        inspectionDate: this._randomDateWithinDays(180),
        inspectionType: this._getRandomInspectionType(),
        inspector: `Inspector ${Math.floor(Math.random() * 5) + 1}`,
        result: Math.random() > 0.3 ? 'pass' : 'fail',
        score: Math.floor(Math.random() * 40) + 60,
        notes: `Inspection notes for ${vin}`,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    return {
      items: inspections,
      total: inspections.length,
      page: 0,
      pageSize: inspections.length
    };
  }

  /**
   * Get compliance report
   */
  async getComplianceReport(context, { period = 'current' } = {}) {
    const vehicles = await this.listVehicles(context);
    
    const compliantVehicles = vehicles.items.filter(v => v.complianceStatus === 'compliant');
    const nonCompliantVehicles = vehicles.items.filter(v => v.complianceStatus !== 'compliant');
    const complianceRate = (compliantVehicles.length / vehicles.items.length * 100) || 0;
    
    const report = {
      reportId: `pave-compliance-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      period,
      totalVehicles: vehicles.items.length,
      compliantVehicles: compliantVehicles.length,
      nonCompliantVehicles: nonCompliantVehicles.length,
      complianceRate: Math.round(complianceRate * 100) / 100,
      vehicles: vehicles.items.map(v => ({
        vin: v.vin,
        licensePlate: v.licensePlate,
        make: v.make,
        model: v.model,
        compliant: v.complianceStatus === 'compliant',
        complianceIssues: [],
        lastInspectionDate: v.lastPaveInspectionDate,
        nextInspectionDue: v.nextPaveInspectionDue,
        daysUntilInspection: Math.ceil(
          (new Date(v.nextPaveInspectionDue) - new Date()) / (1000 * 60 * 60 * 24)
        ),
        paveScore: v.paveScore
      })),
      summary: {
        byStatus: {
          compliant: compliantVehicles.length,
          non_compliant: nonCompliantVehicles.length,
          conditional: 0,
          pending: 0
        },
        bySeverity: {},
        byCategory: {},
        topIssues: []
      },
      recommendations: this._generateRecommendations(complianceRate)
    };
    
    return { report };
  }

  /**
   * Get wear and tear assessment for a vehicle
   */
  async getWearAndTear(context, vin) {
    const vehicle = await this.getVehicleByVin(context, vin);
    
    if (!vehicle) {
      return null;
    }
    
    const inspections = await this.listInspections(context, { vin, limit: 1 });
    const lastInspection = inspections.items[0];
    
    // Generate mock wear and tear data
    const exteriorIssues = [];
    const interiorIssues = [];
    const mechanicalIssues = [];
    
    // Add some random issues based on condition
    if (vehicle.exteriorCondition !== 'excellent') {
      exteriorIssues.push({
        id: `issue-${randomUUID()}`,
        category: 'exterior',
        description: 'Minor scratches on driver side',
        severity: 'minor',
        location: 'Driver door',
        recommendedAction: 'Polish and wax',
        estimatedCost: 150
      });
    }
    
    if (vehicle.interiorCondition !== 'excellent') {
      interiorIssues.push({
        id: `issue-${randomUUID()}`,
        category: 'interior',
        description: 'Stain on passenger seat',
        severity: 'minor',
        location: 'Passenger seat',
        recommendedAction: 'Clean with upholstery cleaner',
        estimatedCost: 50
      });
    }
    
    if (vehicle.mechanicalCondition !== 'excellent') {
      mechanicalIssues.push({
        id: `issue-${randomUUID()}`,
        category: 'mechanical',
        description: 'Slight brake noise',
        severity: 'moderate',
        location: 'Front brakes',
        recommendedAction: 'Inspect brake pads',
        estimatedCost: 200
      });
    }
    
    const allIssues = [...exteriorIssues, ...interiorIssues, ...mechanicalIssues];
    
    return {
      vin,
      inspectionDate: lastInspection?.inspectionDate || new Date().toISOString().split('T')[0],
      inspector: lastInspection?.inspector || 'Unknown',
      exterior: {
        condition: vehicle.exteriorCondition,
        score: this._conditionToScore(vehicle.exteriorCondition),
        issues: exteriorIssues,
        photos: []
      },
      interior: {
        condition: vehicle.interiorCondition,
        score: this._conditionToScore(vehicle.interiorCondition),
        issues: interiorIssues,
        photos: []
      },
      mechanical: {
        condition: vehicle.mechanicalCondition,
        score: this._conditionToScore(vehicle.mechanicalCondition),
        issues: mechanicalIssues,
        photos: []
      },
      overallScore: Math.floor(
        (this._conditionToScore(vehicle.exteriorCondition) +
         this._conditionToScore(vehicle.interiorCondition) +
         this._conditionToScore(vehicle.mechanicalCondition)) / 3
      ),
      lastInspectionDate: vehicle.lastPaveInspectionDate,
      nextInspectionDue: vehicle.nextPaveInspectionDue,
      photos: [],
      notes: `Wear and tear assessment for ${vin}`
    };
  }

  /**
   * Get maintenance records
   */
  async listMaintenance(context, { vin, startDate, endDate, skip = 0, limit = 100 } = {}) {
    const { tenantId } = context;
    
    // Generate mock maintenance data
    const maintenance = [];
    const count = Math.floor(Math.random() * 8) + 1;
    
    for (let i = 0; i < count; i++) {
      maintenance.push({
        id: `maintenance-${randomUUID()}`,
        vehicleId: `pave-${vin}`,
        vin,
        maintenanceType: this._getRandomMaintenanceType(),
        description: `Routine ${this._getRandomMaintenanceType().replace('_', ' ')}`,
        mileage: Math.floor(Math.random() * 50000) + 10000,
        cost: Math.floor(Math.random() * 500) + 50,
        vendor: `Vendor ${Math.floor(Math.random() * 3) + 1}`,
        invoiceNumber: `INV-${Math.floor(Math.random() * 10000)}`,
        status: Math.random() > 0.3 ? 'completed' : 'scheduled',
        scheduledDate: this._randomDateWithinDays(90),
        completedDate: Math.random() > 0.3 ? this._randomDateWithinDays(90) : null,
        notes: `Maintenance notes for ${vin}`,
        partsUsed: [],
        laborHours: Math.floor(Math.random() * 4) + 1,
        warrantyClaim: Math.random() > 0.8,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    return {
      items: maintenance,
      total: maintenance.length,
      page: 0,
      pageSize: maintenance.length
    };
  }

  /**
   * Sync PAVE data (placeholder for actual API integration)
   */
  async syncPaveData(context) {
    const { tenantId } = context;
    
    // In production, this would:
    // 1. Authenticate with PAVE API using credentials from secrets
    // 2. Fetch all vehicles
    // 3. Fetch all inspections
    // 4. Fetch all maintenance records
    // 5. Update local database
    
    this.logger.log('PAVE sync: Not yet implemented. This would connect to the PAVE API.');
    
    return {
      synced: 0,
      failed: 0,
      message: 'PAVE sync not yet implemented. Configure PAVE API credentials to enable.'
    };
  }

  /**
   * Get wear and tear guidelines
   */
  async getWearAndTearGuidelines(context) {
    return {
      exterior: {
        acceptable: ['Minor scratches', 'Small dents', 'Normal wear'],
        unacceptable: ['Large dents', 'Rust', 'Broken parts', 'Excessive scratches'],
        scoringCriteria: [
          { description: 'No visible damage', score: 100, weight: 0.4 },
          { description: 'Minor scratches only', score: 80, weight: 0.3 },
          { description: 'Visible dents or damage', score: 50, weight: 0.2 },
          { description: 'Severe damage or rust', score: 0, weight: 0.1 }
        ]
      },
      interior: {
        acceptable: ['Minor stains', 'Normal wear on seats', 'Clean interior'],
        unacceptable: ['Tears in upholstery', 'Broken equipment', 'Excessive dirt', 'Odors'],
        scoringCriteria: [
          { description: 'Spotless and clean', score: 100, weight: 0.4 },
          { description: 'Minor stains, generally clean', score: 80, weight: 0.3 },
          { description: 'Visible stains or wear', score: 50, weight: 0.2 },
          { description: 'Dirty or damaged interior', score: 0, weight: 0.1 }
        ]
      },
      mechanical: {
        acceptable: ['Normal engine wear', 'Routine maintenance needed'],
        unacceptable: ['Engine issues', 'Brake problems', 'Safety concerns'],
        scoringCriteria: [
          { description: 'All systems operational', score: 100, weight: 0.5 },
          { description: 'Minor issues, fully functional', score: 80, weight: 0.3 },
          { description: 'Requires attention soon', score: 50, weight: 0.15 },
          { description: 'Safety concerns or major issues', score: 0, weight: 0.05 }
        ]
      }
    };
  }

  /**
   * Helper methods
   */
  
  _getRandomPaveStatus() {
    const statuses = ['green', 'yellow', 'red', 'grey'];
    const weights = [0.5, 0.3, 0.1, 0.1];
    const random = Math.random();
    let cumulative = 0;
    for (let i = 0; i < statuses.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return statuses[i];
      }
    }
    return 'grey';
  }

  _getRandomCondition() {
    const conditions = ['excellent', 'good', 'fair', 'poor', 'unacceptable'];
    const weights = [0.2, 0.4, 0.25, 0.1, 0.05];
    const random = Math.random();
    let cumulative = 0;
    for (let i = 0; i < conditions.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return conditions[i];
      }
    }
    return 'fair';
  }

  _getRandomInspectionType() {
    const types = ['pre_trip', 'post_trip', 'weekly', 'monthly', 'quarterly', 'annual', 'safety', 'pave'];
    return types[Math.floor(Math.random() * types.length)];
  }

  _getRandomMaintenanceType() {
    const types = [
      'oil_change', 'tire_rotation', 'brake_service', 'transmission_service',
      'coolant_flush', 'battery_replacement', 'inspection', 'repair'
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  _randomDateWithinDays(days) {
    const now = new Date();
    const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return new Date(past.getTime() + Math.random() * days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
  }

  _randomFutureDate(days) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return new Date(now.getTime() + Math.random() * days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
  }

  _conditionToScore(condition) {
    const scores = {
      excellent: 95,
      good: 80,
      fair: 60,
      poor: 40,
      unacceptable: 20
    };
    return scores[condition] || 0;
  }

  _generateRecommendations(complianceRate) {
    const recommendations = [];
    
    if (complianceRate < 80) {
      recommendations.push('Compliance rate is below 80%. Review non-compliant vehicles and address issues.');
    }
    
    if (complianceRate < 95) {
      recommendations.push('Consider implementing additional training for drivers with non-compliant vehicles.');
    }
    
    return recommendations;
  }
}
