import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPerformanceDashboard } from '../services/scorecard-data-service.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_ROOT = path.resolve(HERE, '..', '..', 'operational-snapshots');

async function operationalSnapshot(name) {
  const source = await fs.readFile(path.join(SNAPSHOT_ROOT, `${name}.json`), 'utf8');
  return JSON.parse(source);
}

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

let evaluationCache;

async function loadEvaluations(dashboardHtmlPath) {
  if (evaluationCache) return evaluationCache;
  if (!dashboardHtmlPath) return {};
  const html = await fs.readFile(dashboardHtmlPath, 'utf8');
  const match = html.match(/window\.__WEEKLY_EVALUATIONS__=(\{.*?\});<\/script>/s);
  evaluationCache = match ? JSON.parse(match[1]) : {};
  return evaluationCache;
}

async function fallbackDrivers(dashboardHtmlPath) {
  const evaluations = await loadEvaluations(dashboardHtmlPath);
  const rows = Object.values(evaluations).flatMap((evaluation) => [
    ...(evaluation.topDrivers || []),
    ...(evaluation.bottomDrivers || [])
  ]);
  const byName = new Map();
  rows.forEach((row) => {
    if (row.name && !byName.has(row.name)) byName.set(row.name, row);
  });
  return [...byName.values()].map((row, index) => ({
    id: `scorecard-${index + 1}`,
    name: row.name,
    status: row.standing || 'Active',
    performanceRating: Number(row.score) || 0
  }));
}

async function fleetRosterFallback() {
  const snapshot = await operationalSnapshot('fleet-compliance');
  if (!Array.isArray(snapshot.vehicles) || snapshot.vehicles.length === 0) return [];
  return snapshot.vehicles.map((vehicle, index) => ({
    id: vehicle.vin || `fleet-${index + 1}`,
    vin: vehicle.vin || '',
    licensePlate: vehicle.registrationNumber || '',
    van_number: vehicle.unit || vehicle.registrationNumber || vehicle.vin?.slice(-7) || `Vehicle ${index + 1}`,
    unit: vehicle.unit || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
    year: Number(vehicle.year) || 0,
    type: vehicle.serviceTier || 'cargo_van',
    ownership: vehicle.ownership || 'UNKNOWN',
    status: vehicle.operationalStatus || vehicle.portalOperationalStatus || 'UNKNOWN',
    operationalStatus: vehicle.operationalStatus || vehicle.portalOperationalStatus || 'UNKNOWN',
    mileage: Number(vehicle.mileage) || 0,
    currentDriverId: null
  }));
}

function warnFallback(request, error, resource) {
  request.log?.warn({ err: error, resource }, 'using React compatibility fallback');
}

export function reactCompatRoutes(app, { repository, dashboardHtmlPath, connectionService = null, includeConnectionSnapshot = true, referenceTenantSlug = 'jec-logistics' }) {
  const hasReferenceData = (request) => request.tenantContext.principal.tenantId === referenceTenantSlug;
  const emptyPerformance = () => ({ period: null, generatedAt: new Date().toISOString(), source: 'No tenant-scoped scorecard source available', needsData: true, drivers: [], history: [], dspPerformance: { overallScore: 0, deliveryScore: 0, safetyScore: 0, efficiencyScore: 0, qualityScore: 0, complianceScore: 0, driverCount: 0, totalDeliveries: 0 } });
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
      warnFallback(request, error, 'drivers');
      return hasReferenceData(request) ? fallbackDrivers(dashboardHtmlPath) : [];
    }
  });

  app.get('/api/drivers/:id', async (request, reply) => {
    try {
      const driver = await repository.getDriver(request.tenantContext, request.params.id);
      return driver || reply.code(404).send({ error: 'driver not found' });
    } catch (error) {
      warnFallback(request, error, 'driver');
      const drivers = await fallbackDrivers(dashboardHtmlPath);
      const driver = drivers.find((item) => item.id === request.params.id);
      return driver || reply.code(404).send({ error: 'driver not found' });
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
      warnFallback(request, error, 'vans');
      items = await fleetRosterFallback();
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
      onTimeDeliveryRate: 100
    })));
  });

  app.get('/api/payroll/periods', async () => page([]));
  app.get('/api/performance/dashboard', async (request) => hasReferenceData(request) ? getPerformanceDashboard(request.query.period) : emptyPerformance());
  app.get('/api/performance/drivers/:id', async (request, reply) => {
    if (!hasReferenceData(request)) return reply.code(404).send({ error: 'driver performance not found' });
    const dashboard = await getPerformanceDashboard(request.query.period);
    const driver = dashboard.drivers.find((row) => row.driverId === request.params.id);
    return driver || reply.code(404).send({ error: 'driver performance not found' });
  });
  app.get('/api/performance/teams/:id', async (_request, reply) => reply.code(404).send({ error: 'team performance is not available from connected sources' }));

  app.get('/api/dashboard/operations', async (request) => {
    if (!hasReferenceData(request)) {
      const connections = connectionService ? await connectionService.list(request.tenantContext) : { connections: [], summary: { connected: 0, connectionTotal: 0 } };
      return { tenant: { id: request.tenantContext.principal.tenantId, name: request.tenantContext.principal.tenantName }, generatedAt: new Date().toISOString(), needsData: true, performance: emptyPerformance(), fleet: emptyFleet(), costs: emptyCosts(), connections, modules: { modules: [] }, sources: (connections.connections || []).map((item) => ({ id: item.id, label: item.displayName || item.name || item.id, asOf: item.lastSuccessAt || null, status: item.status, feeds: item.feeds || [] })) };
    }
    const performance = await getPerformanceDashboard();
    const [fleet, costs, connections, modules] = await Promise.all([
      operationalSnapshot('fleet-compliance'), operationalSnapshot('fleet-costs'),
      connectionService ? connectionService.list(request.tenantContext) : operationalSnapshot('connections'),
      operationalSnapshot('modules')
    ]);
    return {
      tenant: { id: request.tenantContext.principal.tenantId, name: request.tenantContext.principal.tenantName }, generatedAt: new Date().toISOString(), performance, fleet, costs, connections, modules,
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

  app.get('/api/fleet-compliance', async (request) => hasReferenceData(request) ? operationalSnapshot('fleet-compliance') : emptyFleet());
  if (includeConnectionSnapshot) app.get('/api/connections', async () => operationalSnapshot('connections'));
  app.get('/api/vendor-rules', async (request) => hasReferenceData(request) ? operationalSnapshot('vendor-rules') : { rules: [], needsData: true });
  app.get('/api/modules', async (request) => hasReferenceData(request) ? operationalSnapshot('modules') : {
    generatedAt: null, servedAt: new Date().toISOString(), needsData: true,
    summary: { modules: 0, active: 0, readyForImport: 0, cases: 0, openCases: 0, recoveredValue: 0, submitted: 0 },
    modules: [], cases: [], schedules: []
  });

  app.get('/api/fleet-costs/records', async (request) => page(hasReferenceData(request) ? ((await operationalSnapshot('fleet-costs')).charges || []) : []));
  app.get('/api/fleet-costs/summary', async (request) => {
    if (!hasReferenceData(request)) return { ...emptyCosts(), totalCost: 0, totalFixedCost: 0, totalVariableCost: 0, totalCapitalCost: 0, totalOperatingCost: 0, costByCategory: {}, costByVan: [], costByDriver: [], costPerMile: 0, costPerDay: 0, costPerRoute: 0, costPerDelivery: 0, fuelEfficiency: 0, maintenanceCostPerMile: 0 };
    const costs = await operationalSnapshot('fleet-costs');
    const summary = costs.summary || {};
    return {
    period: costs.period, asOf: costs.asOf,
    totalCost: summary.threeMonthIncludedCost || 0,
    totalFixedCost: summary.thirdPartyRentalCost || 0,
    totalVariableCost: (summary.lmrCost || 0) + (summary.elementCost || 0),
    totalCapitalCost: 0, totalOperatingCost: summary.threeMonthIncludedCost || 0,
    costByCategory: { thirdPartyRental: summary.thirdPartyRentalCost || 0, lmr: summary.lmrCost || 0, element: summary.elementCost || 0 },
    costByVan: [], costByDriver: [], costPerMile: 0,
    costPerDay: (summary.threeMonthIncludedCost || 0) / 92,
    costPerRoute: 0, costPerDelivery: 0, fuelEfficiency: 0, maintenanceCostPerMile: 0
  }; });
  app.get('/api/fleet-costs/fuel-analysis', async () => ({
    period: (await operationalSnapshot('fleet-costs')).period, needsData: true,
    message: 'No tenant-scoped fuel-detail source has been ingested', totalFuelCost: 0, totalGallons: 0,
    averagePricePerGallon: 0, totalMiles: 0, fuelEfficiency: 0, costPerMile: 0,
    byVan: [], byDriver: [], trends: []
  }));
  app.get('/api/fleet-costs/maintenance-analysis', async () => ({
    period: (await operationalSnapshot('fleet-costs')).period, needsData: true,
    message: 'No tenant-scoped maintenance-cost source has been ingested', totalMaintenanceCost: 0, byVan: [], byCategory: {},
    averageCostPerMile: 0, averageCostPerVan: 0, trends: []
  }));
  app.get('/api/fleet-costs/trends', async () => (await operationalSnapshot('fleet-costs')).months.map((row) => ({
    period: row.month, totalCost: row.includedCost, amazonCoverage: row.amazonCoverage,
    difference: row.difference, status: row.status, costByCategory: {}, costPerMile: 0, costPerDelivery: 0
  })));
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
    if (!hasReferenceData(request)) return { weeks: [], evaluations: {}, needsData: true, message: 'No tenant-scoped weekly evaluations have been generated' };
    return operationalSnapshot('weekly-evaluations');
  });
}
