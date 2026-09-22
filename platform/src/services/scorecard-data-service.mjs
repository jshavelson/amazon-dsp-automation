/**
 * Scorecard Data Service
 * Reads from local CSV files in data/scorecard_data/
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'path';

const SCORECARD_DATA_DIR = path.resolve(process.cwd(), 'data/scorecard_data');
const PERFORMANCE_SNAPSHOT = path.resolve(process.cwd(), 'platform/operational-snapshots/performance.json');

async function packagedPerformance() {
  try { return JSON.parse(await fsp.readFile(PERFORMANCE_SNAPSHOT, 'utf8')); }
  catch { return null; }
}

/**
 * Simple CSV parser
 */
export function parseCSV(content) {
  const records = [];
  let record = [], field = '', quoted = false;
  const source = String(content).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' && quoted && source[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { record.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      record.push(field.trim()); field = '';
      if (record.some((value) => value !== '')) records.push(record);
      record = [];
    } else field += char;
  }
  if (field || record.length) { record.push(field.trim()); records.push(record); }
  if (!records.length) return [];
  const headers = records[0];
  const rows = [];
  for (const values of records.slice(1)) {
    const row = {};
    for (let j = 0; j < Math.min(headers.length, values.length); j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }
  
  return rows;
}

/**
 * Get the latest week folder
 */
export function getLatestWeekFolder() {
  try {
    const weeks = fs.readdirSync(SCORECARD_DATA_DIR)
      .filter(dir => dir.match(/^\d{4}-wk\d{2}$/))
      .sort()
      .reverse();
    return weeks[0] || null;
  } catch {
    return null;
  }
}

/**
 * Read CSV file from scorecard data
 */
async function readScorecardCSV(week, filename) {
  const weekPath = path.join(SCORECARD_DATA_DIR, week);
  const filePath = path.join(weekPath, filename);
  
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    return parseCSV(content);
  } catch {
    return [];
  }
}

/**
 * Get driver performance data from DSP_Overview_Dashboard CSV
 */
export async function getDriverPerformance(week = null) {
  const targetWeek = week || getLatestWeekFolder();
  if (!targetWeek) return { week: null, drivers: [], summary: {} };
  
  const files = await fsp.readdir(path.join(SCORECARD_DATA_DIR, targetWeek)).catch(() => []);
  const overview = files.find((name) => /^DSP_Overview_Dashboard_.*\.csv$/i.test(name));
  const data = overview ? await readScorecardCSV(targetWeek, overview) : [];
  
  if (!data || data.length === 0) {
    return { week: targetWeek, drivers: [], summary: {} };
  }
  
  const drivers = data.map(row => ({
    id: row['Transporter ID'] || '',
    name: String(row['Delivery Associate'] || row['Delivery Associate '] || '').trim(),
    overallScore: parseFloat(row['Overall Score']) || 0,
    overallStanding: row['Overall Standing'] || '',
    ficoScore: parseFloat(row['FICO Score']) || 0,
    dcr: parseFloat(row['DCR']) || 0,
    dcrTier: row['DCR Tier'] || '',
    pod: parseFloat(row['POD']) || 0,
    podTier: row['POD Tier'] || '',
    cdf: parseFloat(row['CDF DPMO']) || 0,
    cdfTier: row['CDF DPMO Tier'] || '',
    dsb: parseFloat(row['DSB']) || 0,
    dsbTier: row['DSB DPMO Tier'] || '',
    psb: parseFloat(row['PSB']) || 0,
    psbTier: row['PSB Tier'] || '',
    packagesDelivered: parseInt(String(row['Packages Delivered'] || '').replace(/,/g, '')) || 0,
    speedingRate: parseFloat(row['Speeding Event Rate (per trip)']) || 0,
    seatbeltRate: parseFloat(row['Seatbelt-Off Rate (per trip)']) || 0,
    distractionRate: parseFloat(row['Distractions Rate (per trip)']) || 0,
    status: row['Overall Standing']?.toLowerCase() || 'active'
  }));
  
  drivers.sort((a, b) => b.overallScore - a.overallScore);
  
  const summary = {
    totalDrivers: drivers.length,
    averageScore: drivers.reduce((sum, d) => sum + d.overallScore, 0) / drivers.length || 0,
    topPerformers: drivers.slice(0, 5),
    needsImprovement: drivers.slice(-5).reverse()
  };
  
  return { week: targetWeek, drivers, summary };
}

/**
 * Get fleet data from vehicle files
 */
export async function getFleetData() {
  try {
    const vehiclesFile = path.join(SCORECARD_DATA_DIR, '_templates/', 'vehicles-1.json');
    const content = await fsp.readFile(vehiclesFile, 'utf8');
    const vehicles = JSON.parse(content);
    return vehicles;
  } catch {
    // Fallback to mock data
    return [
      { id: 'EDV-01', vin: '7FCEHEB20RN026201', licensePlate: 'EDV001', make: 'Ford', model: 'Transit', year: 2023, type: 'Cargo Van', ownership: 'Amazon Owned', status: 'active', homeStationId: 'DFH7' },
      { id: 'EDV-02', vin: '7FCEHEB28SN031331', licensePlate: 'EDV002', make: 'Ford', model: 'Transit', year: 2023, type: 'Cargo Van', ownership: 'Amazon LMR', status: 'active', homeStationId: 'DFH7' },
      { id: 'EDV-03', vin: '1FTEW1E83PKD00001', licensePlate: 'EDV003', make: 'Ford', model: 'Transit', year: 2023, type: 'Cargo Van', ownership: 'Rental', status: 'active', homeStationId: 'DFH7' }
    ];
  }
}

/**
 * Get timecard/payroll data
 */
export async function getTimecards(week = null) {
  const targetWeek = week || getLatestWeekFolder();
  if (!targetWeek) return { week: null, timecards: [], summary: {} };
  
  // Try to read from ADP payroll data
  try {
    const payrollDir = path.join(SCORECARD_DATA_DIR, targetWeek);
    const files = await fsp.readdir(payrollDir);
    
    // Look for payroll register or timecard files
    const payrollFile = files.find(f => 
      f.includes('payroll') || f.includes('timecard') || f.includes('ADP')
    );
    
    if (payrollFile) {
      const content = await fsp.readFile(path.join(payrollDir, payrollFile), 'utf8');
      const data = parseCSV(content);
      return { week: targetWeek, timecards: data, summary: { total: data.length } };
    }
  } catch {
    // Return mock data
  }
  
  return { week: targetWeek, timecards: [], summary: { total: 0 }, needsData: true };
}

/**
 * Get route data
 */
export async function getRoutes(date = null) {
  const targetWeek = getLatestWeekFolder();
  if (!targetWeek) return { date: null, routes: [], summary: {} };
  
  // Try to read DA Daily Reports
  try {
    const weekPath = path.join(SCORECARD_DATA_DIR, targetWeek);
    const files = await fsp.readdir(weekPath);
    const dailyReports = files.filter(f => f.includes('DA-Daily-Report'));
    
    if (dailyReports.length > 0) {
      return { date: date || null, week: targetWeek, routes: [], summary: { total: 0 }, needsData: true, evidenceFiles: dailyReports.length };
    }
  } catch {
    // Return mock data
  }
  
  return { date: date || null, routes: [], summary: {} };
}

/**
 * Get dispute candidates from weekly analysis
 */
export async function getDisputeCandidates(week = null) {
  const targetWeek = week || getLatestWeekFolder();
  if (!targetWeek) return { week: null, disputes: [], summary: {} };
  
  try {
    const disputesFile = path.join(SCORECARD_DATA_DIR, targetWeek, `${targetWeek}-disputes.md`);
    const content = await fsp.readFile(disputesFile, 'utf8');
    
    // Parse markdown disputes file
    const disputes = [];
    const lines = content.split('\n');
    let currentDispute = null;
    
    for (const line of lines) {
      if (line.startsWith('## ') || line.startsWith('# ')) {
        if (currentDispute) disputes.push(currentDispute);
        currentDispute = { title: line.replace(/^#+\s*/, ''), details: [] };
      } else if (line.trim() && !line.startsWith('---')) {
        currentDispute?.details.push(line);
      }
    }
    
    if (currentDispute) disputes.push(currentDispute);
    
    return { week: targetWeek, disputes, summary: { total: disputes.length } };
  } catch {
    return { week: targetWeek, disputes: [], summary: { total: 0 }, needsData: true };
  }
}

export async function getPerformanceDashboard(week = null) {
  if (!getLatestWeekFolder()) {
    const snapshot = await packagedPerformance();
    if (snapshot && (!week || snapshot.period === week)) return snapshot;
  }
  const current = await getDriverPerformance(week);
  const officialPerformance = await packagedPerformance();
  const officialHistory = new Map((officialPerformance?.history || []).map((row) => [row.period, row]));
  const officialCurrent = officialHistory.get(current.week);
  const drivers = current.drivers.map((driver, index) => ({
    driverId: driver.id, driverName: driver.name, period: current.week,
    metrics: [], overallScore: driver.overallScore,
    deliveryScore: driver.dcr || driver.pod || 0,
    safetyScore: Math.max(0, 100 - (driver.speedingRate + driver.seatbeltRate + driver.distractionRate) * 100),
    efficiencyScore: driver.overallScore, qualityScore: driver.pod || 0,
    costScore: 0, complianceScore: driver.overallScore,
    rank: index + 1, percentile: Math.round((current.drivers.length - index) / Math.max(current.drivers.length, 1) * 100),
    trend: 'stable', week: current.week?.replace('wk', 'W'), year: Number(current.week?.slice(0, 4)),
    score: driver.overallScore, grade: driver.overallStanding,
    onTimeDeliveryRate: driver.dcr || 0, safetyIncidents: 0,
    customerComplaints: driver.cdf || 0, packagesPerHour: 0,
    routeCompletionRate: driver.dcr || 0, fuelEfficiency: 0
  }));
  const avg = (key) => drivers.reduce((sum, row) => sum + Number(row[key] || 0), 0) / Math.max(drivers.length, 1);
  const dspPerformance = {
    dspId: 'JECS', period: current.week, overallScore: officialCurrent?.overallScore ?? officialPerformance?.dspPerformance?.overallScore ?? null, deliveryScore: avg('deliveryScore'),
    safetyScore: avg('safetyScore'), efficiencyScore: avg('efficiencyScore'), qualityScore: avg('qualityScore'),
    costScore: 0, complianceScore: avg('complianceScore'), driverCount: drivers.length, vanCount: 0,
    routeCount: 0, totalMiles: 0, totalDeliveries: drivers.reduce((sum, row) => sum + Number(current.drivers.find((d) => d.id === row.driverId)?.packagesDelivered || 0), 0),
    onTimeDeliveryRate: avg('onTimeDeliveryRate'), customerSatisfaction: 0, costPerDelivery: 0,
    profitMargin: 0, safetyIncidentRate: 0, retentionRate: 0, utilizationRate: 0
  };
  const folders = fs.existsSync(SCORECARD_DATA_DIR)
    ? fs.readdirSync(SCORECARD_DATA_DIR).filter((name) => /^\d{4}-wk\d{2}$/.test(name)).sort().slice(-13)
    : [];
  const history = [];
  for (const folder of folders) {
    const weekly = folder === current.week ? current : await getDriverPerformance(folder);
    if (!weekly.drivers.length) continue;
    const average = (key) => weekly.drivers.reduce((sum, row) => sum + Number(row[key] || 0), 0) / weekly.drivers.length;
    history.push({
      period: folder, overallScore: officialHistory.get(folder)?.overallScore ?? null,
      overallStanding: officialHistory.get(folder)?.overallStanding ?? null,
      averageDaScore: average('overallScore'), pod: average('pod'), dcr: average('dcr'),
      cdf: weekly.drivers.reduce((sum, row) => sum + Number(row.cdf || 0), 0),
      packages: weekly.drivers.reduce((sum, row) => sum + Number(row.packagesDelivered || 0), 0),
      activeDrivers: weekly.drivers.length
    });
  }
  return {
    period: current.week, generatedAt: new Date().toISOString(), source: `Amazon DSP scorecard ${current.week}`,
    dspPerformance, teamPerformance: [], topDrivers: drivers.slice(0, 5), bottomDrivers: drivers.slice(-5).reverse(),
    drivers, history, metricTrends: [], scoreDistribution: {
      excellent: drivers.filter((d) => d.overallScore >= 95).length,
      good: drivers.filter((d) => d.overallScore >= 90 && d.overallScore < 95).length,
      average: drivers.filter((d) => d.overallScore >= 80 && d.overallScore < 90).length,
      belowAverage: drivers.filter((d) => d.overallScore >= 70 && d.overallScore < 80).length,
      poor: drivers.filter((d) => d.overallScore < 70).length, total: drivers.length
    }
  };
}

export default {
  getDriverPerformance,
  getFleetData,
  getTimecards,
  getRoutes,
  getDisputeCandidates
  ,getPerformanceDashboard
};
