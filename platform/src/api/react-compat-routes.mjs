import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const fleetFallback = [
  { id: 'fleet-1', vin: '1FTBW3XG7RKA10001', licensePlate: 'JECS-101', make: 'Ford', model: 'Transit', year: 2024, status: 'active', mileage: 18420 },
  { id: 'fleet-2', vin: '1FTBW3XG7RKA10002', licensePlate: 'JECS-102', make: 'Ford', model: 'Transit', year: 2024, status: 'active', mileage: 21985 },
  { id: 'fleet-3', vin: 'W1Y4KBHY8RT100003', licensePlate: 'JECS-201', make: 'Mercedes-Benz', model: 'Sprinter', year: 2024, status: 'maintenance', mileage: 26740 }
];

async function routeFallback(dashboardHtmlPath) {
  const drivers = await fallbackDrivers(dashboardHtmlPath);
  return drivers.slice(0, 3).map((driver, index) => ({
    id: `DFH7-${String(index + 1).padStart(3, '0')}`,
    date: '2026-09-20',
    driverId: driver.id,
    vanId: fleetFallback[index]?.id || '',
    packagesTotal: [312, 286, 301][index],
    milesDriven: [74.2, 68.5, 81.1][index],
    status: index === 2 ? 'assigned' : 'completed'
  }));
}

function warnFallback(request, error, resource) {
  request.log?.warn({ err: error, resource }, 'using React compatibility fallback');
}

export function reactCompatRoutes(app, { repository, dashboardHtmlPath }) {
  app.get('/api/auth/me', async (request) => {
    const principal = request.tenantContext.principal;
    const [firstName = '', ...lastNameParts] = (principal.email || 'DSP User').split('@')[0].split(/[._-]/);
    return {
      id: principal.userId,
      email: principal.email,
      firstName: firstName || 'DSP',
      lastName: lastNameParts.join(' ') || 'User',
      role: principal.role,
      status: 'active'
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
      return fallbackDrivers(dashboardHtmlPath);
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
      items = fleetFallback;
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
      items = await routeFallback(dashboardHtmlPath);
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
  app.get('/api/performance/dashboard', async () => ({}));
  app.get('/api/performance/drivers/:id', async () => ({}));
  app.get('/api/performance/teams/:id', async () => ({}));

  app.get('/api/fleet-compliance', async () => operationalSnapshot('fleet-compliance'));
  app.get('/api/connections', async () => operationalSnapshot('connections'));
  app.get('/api/vendor-rules', async () => operationalSnapshot('vendor-rules'));
  app.get('/api/modules', async () => operationalSnapshot('modules'));

  app.get('/api/fleet-costs/records', async () => page([]));
  app.get('/api/fleet-costs/summary', async () => ({
    period: 'June–August 2026', totalCost: 79904.99, totalFixedCost: 39345,
    totalVariableCost: 40559.99, totalCapitalCost: 0, totalOperatingCost: 79904.99,
    costByCategory: { leasing: 39345, other: 40559.99 }, costByVan: [], costByDriver: [],
    costPerMile: 0, costPerDay: 868.53, costPerRoute: 0, costPerDelivery: 0,
    fuelEfficiency: 0, maintenanceCostPerMile: 0
  }));
  app.get('/api/fleet-costs/fuel-analysis', async () => ({
    period: 'June–August 2026', totalFuelCost: 0, totalGallons: 0,
    averagePricePerGallon: 0, totalMiles: 0, fuelEfficiency: 0, costPerMile: 0,
    byVan: [], byDriver: [], trends: []
  }));
  app.get('/api/fleet-costs/maintenance-analysis', async () => ({
    period: 'June–August 2026', totalMaintenanceCost: 0, byVan: [], byCategory: {},
    averageCostPerMile: 0, averageCostPerVan: 0, trends: []
  }));
  app.get('/api/fleet-costs/trends', async () => ([
    { period: 'June', totalCost: 21334, costByCategory: {}, costPerMile: 0, costPerDelivery: 0 },
    { period: 'July', totalCost: 25743, costByCategory: {}, costPerMile: 0, costPerDelivery: 0 },
    { period: 'August', totalCost: 32828, costByCategory: {}, costPerMile: 0, costPerDelivery: 0 }
  ]));
  app.get('/api/fleet-costs/budgets', async () => []);
  app.get('/api/fleet-costs/forecasts', async () => []);

  app.get('/api/time-attendance/exceptions', async () => ({
    sourcePeriod: '2026-09-13 to 2026-09-19',
    capturedAt: '2026-09-16',
    exceptions: [
      { employee: 'Davis, George', date: '2026-09-13', issueType: 'Unassigned shift', details: 'ADP time but no Amazon route assignment' },
      { employee: 'Davis, George', date: '2026-09-14', issueType: 'Unassigned shift', details: 'ADP time but no Amazon route assignment' },
      ...[15, 16, 17, 18, 19].map((day) => ({
        employee: 'Davis, George', date: `2026-09-${day}`, issueType: 'Missed punch', details: `No time recorded for 2026-09-${day}`
      }))
    ]
  }));

  app.get('/api/weekly-evaluations', async () => {
    const evaluations = await loadEvaluations(dashboardHtmlPath);
    return { weeks: Object.keys(evaluations), evaluations };
  });
}
