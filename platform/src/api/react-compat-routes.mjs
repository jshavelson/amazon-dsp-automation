
const page = (data) => ({
  data,
  meta: {
    currentPage: 1,
    totalPages: 1,
    totalItems: data.length,
    itemsPerPage: Math.max(data.length, 1),
    hasNextPage: false,
    hasPreviousPage: false
  }
});

function warnFallback(request, error, resource) {
  request.log?.warn({ err: error, resource }, 'using React compatibility fallback');
}

export function mergeFleetConditionReport(base, report) {
  if (!report || !Array.isArray(report.vehicles)) return base;
  const vehicles = [...new Map(report.vehicles.filter((vehicle) => vehicle?.vin).map((vehicle) => [vehicle.vin, vehicle])).values()];
  const eligible = Number(report.eligibleVehicleCount);
  const reportedPassing = Number(report.wearTearPassingCount);
  const passing = vehicles.filter((vehicle) => Number(vehicle.wearTearGrade) >= 3 || /Non-Con|Exclusion|LSC/i.test(vehicle.fcaStatus || '')).length;
  const compliant = vehicles.filter((vehicle) => /^Compliant/i.test(vehicle.fcaStatus || '')).length;
  const currentPercent = Number(report.currentQuarterWearTearPercent);
  const calculatedPercent = vehicles.length ? passing / vehicles.length * 100 : Number.NaN;
  if (!vehicles.length || eligible !== vehicles.length || reportedPassing !== passing || Math.abs(calculatedPercent - currentPercent) > 0.05) {
    throw new Error('Fleet Condition report summary does not reconcile with its VIN-level rows');
  }

  const rosterByVin = new Map((base.vehicles || []).map((vehicle) => [vehicle.vin, vehicle]));
  const lscCases = base.wearAndTear?.lscCases || [];
  const casesByVin = new Map();
  for (const item of lscCases) {
    if (!item.vin) continue;
    casesByVin.set(item.vin, [...(casesByVin.get(item.vin) || []), item.caseNumber]);
  }
  const repairCandidates = vehicles.filter((vehicle) => Number(vehicle.wearTearGrade) === 2
    && !/Non-Con|Exclusion|LSC/i.test(vehicle.fcaStatus || '')).map((vehicle) => {
    const roster = rosterByVin.get(vehicle.vin);
    const caseNumbers = casesByVin.get(vehicle.vin) || [];
    return {
      vin: vehicle.vin, unit: roster?.unit || 'Roster match required', grade: 2,
      lastPave: vehicle.lastPaveAt, reportSection: vehicle.fcaStatus,
      operationalStatus: roster?.operationalStatus || 'UNKNOWN', ownership: roster?.ownership || 'UNKNOWN',
      provider: roster?.provider || null, caseNumbers,
      recommendedAction: caseNumbers.length
        ? 'Complete repairs and the case-required replacement FCA before requesting ungrounding.'
        : 'Repair to Fair+ (grade 3 or better), complete a new FCA, and verify the rolling metric posts.'
    };
  }).sort((left, right) => Number(left.operationalStatus !== 'OPERATIONAL') - Number(right.operationalStatus !== 'OPERATIONAL')
    || String(left.lastPave || '').localeCompare(String(right.lastPave || ''))
    || String(left.unit).localeCompare(String(right.unit)));

  const targetPercent = Number(base.wearAndTear?.targetPercent || 0);
  const stretchPercent = Number(base.wearAndTear?.stretchPercent || targetPercent);
  const targetCompliant = Math.ceil(targetPercent / 100 * eligible);
  const stretchCompliant = Math.ceil(stretchPercent / 100 * eligible);
  const minimumAdditionalCompliant = Math.max(targetCompliant - passing, 0);
  const stretchAdditionalCompliant = Math.max(stretchCompliant - passing, 0);
  const dueDate = vehicles.map((vehicle) => vehicle.dueDate).filter(Boolean).sort().at(-1) || null;
  const source = { authoritativeSystem: 'amazon_connector', reportLocation: 'Supplemental Reports / Fleet Condition Assessment (FCA) / Wear & Tear (W&T) Dashboard' };
  const actions = [
    { id: 'prioritize-operational-poor', title: 'Start with operational grade-2 vehicles', detail: 'Repair and reassess operational units first so the target can improve without waiting for grounded-vehicle release.' },
    { id: 'complete-minimum', title: `Close at least ${minimumAdditionalCompliant} additional compliant assessments`, detail: `The exact report threshold is ${targetCompliant} of ${eligible} Fair+ vehicles. Upload complete FCA evidence and confirm the rolling metric posts.` },
    { id: 'build-buffer', title: `Schedule ${stretchAdditionalCompliant} completions for a ${stretchPercent.toFixed(0)}% buffer`, detail: `${stretchCompliant} of ${eligible} equals ${(stretchCompliant / eligible * 100).toFixed(1)}%, protecting against rejected evidence and posting lag.` },
    { id: 'close-lsc-evidence', title: 'Advance open LSC cases without crediting them as complete', detail: 'Attach repair/FCA evidence to each case and keep the vehicle outside the compliant numerator until Amazon accepts the assessment.' }
  ];
  return {
    ...base,
    fleetCondition: { needsData: false, status: 'current', source: 'amazon_connector', capturedAt: report.capturedAt },
    fcaCompliance: {
      previousQuarterPercent: Number(report.previousQuarterFcaPercent),
      currentQuarterRollingPercent: Number(report.currentQuarterFcaPercent),
      needsInspectionCount: Math.max(eligible - compliant, 0), temporaryExclusionCount: vehicles.filter((vehicle) => /Exclusion/i.test(vehicle.fcaStatus || '')).length,
      compliantVehicleCount: compliant, eligibleVehicleCount: eligible, nonCompliantVehicleCount: Math.max(eligible - compliant, 0),
      reportedAt: report.capturedAt, dueDate, source
    },
    wearAndTear: {
      ...(base.wearAndTear || {}), currentPercent, previousQuarterPercent: Number(report.previousQuarterWearTearPercent),
      planningDenominator: eligible, eligibleVehicleCount: eligible, estimatedCurrentCompliant: passing,
      wearTearPassingCount: passing, poorGradeVehicleCount: repairCandidates.length,
      targetPercent, targetCompliant, minimumAdditionalCompliant, stretchPercent, stretchCompliant, stretchAdditionalCompliant,
      percentagePointGap: Math.max(targetPercent - currentPercent, 0), dueDate, repairCandidates, lscCases,
      openLscCaseCount: lscCases.filter((item) => item.status !== 'closed').length, actions, source, reportedAt: report.capturedAt,
      planningBasis: `Amazon connector VIN reconciliation: ${passing} of ${eligible} eligible vehicles are grade 3 (Fair) or better, producing ${currentPercent.toFixed(1)}%.`,
      dataStatus: 'current'
    },
    sources: [...(base.sources || []).filter((item) => !item.label.includes('Fleet Condition Assessment')),
      { label: 'Amazon connector · Fleet Condition Assessment (FCA) · Wear & Tear', asOf: String(report.capturedAt).slice(0, 10), path: 'tenant-scoped connector artifact', status: 'current' }]
  };
}

export function withoutUnverifiedFleetCondition(base) {
  return {
    ...base,
    fcaCompliance: null,
    wearAndTear: null,
    fleetCondition: {
      needsData: true,
      status: 'needs_data',
      source: 'amazon_connector',
      message: 'A VIN-complete Amazon Fleet Condition connector pull is required. Email summaries and archived email vehicle tables are not used.'
    },
    sources: (base.sources || []).filter((item) => !/Fleet Condition Assessment|Wear\s*&\s*Tear/i.test(item.label || ''))
  };
}

export function reactCompatRoutes(app, { repository, dashboardHtmlPath, connectionService = null, includeConnectionSnapshot = true, referenceTenantSlug = 'jec-logistics' }) {
  const emptyPerformance = () => ({ period: null, generatedAt: new Date().toISOString(), source: 'No tenant-scoped scorecard connector artifact available', status: 'needs_data', needsData: true, drivers: [], history: [], dspPerformance: { overallScore: null, deliveryScore: null, safetyScore: null, efficiencyScore: null, qualityScore: null, complianceScore: null, driverCount: null, totalDeliveries: null } });
  const emptyFleet = () => ({ asOf: null, generatedAt: new Date().toISOString(), needsData: true, message: 'No tenant-scoped fleet source has been ingested', summary: { registeredFleet: 0, operational: 0, grounded: 0, ready: 0 }, vehicles: [] });
  const emptyCosts = () => ({ asOf: null, period: null, needsData: true, message: 'No tenant-scoped accounting source has been ingested', months: [], charges: [], summary: {} });
  app.get('/api/auth/me', async (request) => {
    const principal = request.tenantContext.principal;
    const roleMap = {
      platform_admin: 'super_admin',
      owner: 'dsp_owner',
      admin: 'operations_manager',
      reviewer: 'viewer',
      analyst: 'viewer',
      viewer: 'viewer'
    };
    const [firstName = '', ...lastNameParts] = (principal.email || 'DSP User').split('@')[0].split(/[._-]/);
    return {
      id: principal.userId,
      email: principal.email || '',
      firstName: firstName || 'DSP',
      lastName: lastNameParts.join(' ') || 'User',
      role: roleMap[principal.role] || 'viewer',
      status: 'active',
      emailVerified: true,
      mfaEnabled: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  app.get('/api/drivers', async (request) => {
    const { limit = 100, page: pageNumber = 1 } = request.query;
    try {
      const result = await repository.listDrivers(request.tenantContext, {
        limit: Number(limit),
        skip: (Math.max(Number(pageNumber), 1) - 1) * Number(limit)
      });
      return result.items;
    } catch (error) {
      request.log?.error({ err: error, resource: 'drivers' }, 'live tenant driver query failed');
      return [];
    }
  });

  app.get('/api/drivers/:id', async (request, reply) => {
    try {
      const driver = await repository.getDriver(request.tenantContext, request.params.id);
      return driver || reply.code(404).send({ error: 'driver not found' });
    } catch (error) {
      request.log?.error({ err: error, resource: 'driver' }, 'live tenant driver query failed');
      return reply.code(503).send({ error: 'live driver source unavailable' });
    }
  });

  app.get('/api/vans', async (request) => {
    const { limit = 100, page: pageNumber = 1 } = request.query;
    let items;
    try {
      const result = await repository.listVans(request.tenantContext, {
        limit: Number(limit),
        skip: (Math.max(Number(pageNumber), 1) - 1) * Number(limit)
      });
      items = result.items;
    } catch (error) {
      request.log?.error({ err: error, resource: 'vans' }, 'live tenant fleet query failed');
      items = [];
    }
    return page(items.map((van) => ({
      ...van,
      licensePlate: van.licensePlate || van.vin?.slice(-7) || '',
      type: van.type || 'cargo_van',
      ownership: van.ownership || 'owned',
      status: van.status || 'active',
      mileage: van.mileage || 0,
      currentDriverId: null
    })));
  });

  app.get('/api/routes', async (request) => {
    const { limit = 100, page: pageNumber = 1, date } = request.query;
    let items;
    try {
      const result = await repository.listRoutes(request.tenantContext, {
        date,
        limit: Number(limit),
        skip: (Math.max(Number(pageNumber), 1) - 1) * Number(limit)
      });
      items = result.items;
    } catch (error) {
      warnFallback(request, error, 'routes');
      items = [];
    }
    return page(items.map((route) => ({
      ...route,
      routeNumber: route.id,
      routeName: route.id,
      driverName: route.driverId || 'Unassigned',
      vanLicensePlate: route.vanId || 'Unassigned',
      totalPackages: route.packagesTotal || 0,
      totalMiles: route.milesDriven || 0,
      onTimeDeliveryRate: null
    })));
  });

  app.get('/api/payroll/periods', async () => page([]));
  app.get('/api/performance/dashboard', async () => emptyPerformance());
  app.get('/api/performance/drivers/:id', async (request, reply) => {
    return reply.code(404).send({ error: 'live driver performance has not been ingested' });
  });
  app.get('/api/performance/teams/:id', async (_request, reply) => reply.code(404).send({ error: 'team performance is not available from connected sources' }));

  app.get('/api/dashboard/operations', async (request) => {
    const connections = connectionService ? await connectionService.list(request.tenantContext) : { connections: [], summary: { connected: 0, connectionTotal: 0 } };
    const report = repository.getLatestFleetConditionReport ? await repository.getLatestFleetConditionReport(request.tenantContext).catch(() => null) : null;
    const fleet = report ? mergeFleetConditionReport(emptyFleet(), report) : withoutUnverifiedFleetCondition(emptyFleet());
    const performance = emptyPerformance();
    const costs = emptyCosts();
    return {
      tenant: { id: request.tenantContext.principal.tenantId, name: request.tenantContext.principal.tenantName }, generatedAt: new Date().toISOString(), needsData: true, performance, fleet, costs, connections, modules: { modules: [] },
      sources: (connections.connections || []).map((item) => {
        const manual = item.authKind === 'manual_upload';
        return {
          id: item.id,
          label: item.displayName || item.name || item.id,
          asOf: item.lastSuccessAt
            || (item.id === 'amazon' ? performance.period : null)
            || (item.id === 'pave' ? fleet.generatedAt || fleet.asOf : null)
            || (manual ? costs.asOf : null),
          status: manual ? (costs.needsData ? 'needs_data' : 'current') : item.status,
          feeds: item.feeds || []
        };
      })
    };
  });

  app.get('/api/fleet-compliance', async (request) => {
    const base = emptyFleet();
    if (!repository.getLatestFleetConditionReport) return base;
    try {
      const report = await repository.getLatestFleetConditionReport(request.tenantContext);
      if (!report) return withoutUnverifiedFleetCondition(base);
      return mergeFleetConditionReport(base, report);
    } catch (error) {
      warnFallback(request, error, 'fleet-condition');
      return withoutUnverifiedFleetCondition(base);
    }
  });
  if (includeConnectionSnapshot) app.get('/api/connections', async () => ({ connections: [], summary: { connected: 0, connectionTotal: 0 }, needsData: true }));
  app.get('/api/vendor-rules', async () => ({ rules: [], needsData: true, message: 'No tenant-scoped vendor rules are stored' }));
  app.get('/api/modules', async () => ({
    generatedAt: null, servedAt: new Date().toISOString(), needsData: true,
    summary: { modules: 0, active: 0, readyForImport: 0, cases: 0, openCases: 0, recoveredValue: 0, submitted: 0 },
    modules: [], cases: [], schedules: []
  }));

  app.get('/api/fleet-costs/records', async () => page([]));
  app.get('/api/fleet-costs/summary', async () => ({ ...emptyCosts(), totalCost: null, totalFixedCost: null, totalVariableCost: null, totalCapitalCost: null, totalOperatingCost: null, costByCategory: {}, costByVan: [], costByDriver: [], costPerMile: null, costPerDay: null, costPerRoute: null, costPerDelivery: null, fuelEfficiency: null, maintenanceCostPerMile: null }));
  app.get('/api/fleet-costs/fuel-analysis', async () => ({
    period: null, needsData: true,
    message: 'No tenant-scoped fuel-detail source has been ingested', totalFuelCost: 0, totalGallons: 0,
    averagePricePerGallon: 0, totalMiles: 0, fuelEfficiency: 0, costPerMile: 0,
    byVan: [], byDriver: [], trends: []
  }));
  app.get('/api/fleet-costs/maintenance-analysis', async () => ({
    period: null, needsData: true,
    message: 'No tenant-scoped maintenance-cost source has been ingested', totalMaintenanceCost: 0, byVan: [], byCategory: {},
    averageCostPerMile: 0, averageCostPerVan: 0, trends: []
  }));
  app.get('/api/fleet-costs/trends', async () => []);
  app.get('/api/fleet-costs/budgets', async () => []);
  app.get('/api/fleet-costs/forecasts', async () => []);

  app.get('/api/time-attendance/exceptions', async (request) => {
    const result = await repository.listAttendanceExceptions(request.tenantContext, { limit: 500 });
    const sourcePeriod = result.startDate && result.endDate ? `${result.startDate} to ${result.endDate}` : null;
    return {
      source: 'ADP Workforce Now API',
      sourcePeriod,
      capturedAt: result.capturedAt,
      needsData: !sourcePeriod,
      message: sourcePeriod
        ? `Live tenant-scoped ADP timecards for ${result.employees} employees; ${result.routeReconciliationAvailable ? 'reconciled with Amazon daily assignments' : 'Amazon daily assignments are not loaded, so route-based exceptions are withheld'}`
        : 'No tenant-scoped ADP timecards have been ingested',
      coverage: {
        employees: result.employees || 0,
        dailyAssignments: result.dailyAssignments || 0,
        routeReconciliationAvailable: result.routeReconciliationAvailable,
      },
      exceptions: result.items
    };
  });

  app.get('/api/weekly-evaluations', async (request) => {
    return { weeks: [], evaluations: {}, needsData: true, message: 'No tenant-scoped live weekly evaluation artifact has been ingested' };
  });
}
