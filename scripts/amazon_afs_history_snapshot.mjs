#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const year = Number(args.year || new Date().getFullYear());
  const startWeek = Number(args['start-week']);
  const endWeek = Number(args['end-week'] || startWeek);
  if (![year, startWeek, endWeek].every(Number.isInteger) || startWeek < 1 || endWeek > 53 || startWeek > endWeek) {
    throw new Error('Use integer --year, --start-week, and --end-week values; weeks must be 1-53');
  }

  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/amazon_logistics.config.json'), 'utf8'));
  const serviceAreaId = args['service-area-id'] || config.executionServiceAreaId;
  if (!serviceAreaId) throw new Error('executionServiceAreaId is required in amazon_logistics.config.json');
  const storageState = path.resolve(ROOT, args['storage-state'] || config.storageStatePath);
  const outputDir = path.resolve(ROOT, args['output-dir'] || `data/fleet_reviews/afs-history/${year}`);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState });
    const manifest = { source: 'Amazon Fleet Management AFS API', year, serviceAreaId, capturedAt: new Date().toISOString(), weeks: [] };
    for (let week = startWeek; week <= endWeek; week += 1) {
      const url = `https://logistics.amazon.com/fleet-management/api/afs-summary?year=${year}&weekNo=${week}&serviceAreaId=${encodeURIComponent(serviceAreaId)}`;
      const response = await context.request.get(url);
      if (response.status() !== 200 || response.url().includes('/ap/signin')) {
        throw new Error(`Amazon AFS request failed for W${week}: HTTP ${response.status()}`);
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`Amazon AFS request returned non-JSON for W${week}; refresh the saved session`);
      }
      const destination = path.join(outputDir, `week${String(week).padStart(2, '0')}-afs-summary.json`);
      await fs.writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      manifest.weeks.push({ week, file: path.basename(destination), cargoVanTotalAFS: payload?.CARGO_VAN?.totalAFS ?? null });
    }
    await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await context.storageState({ path: storageState });
    await fs.chmod(storageState, 0o600);
    console.log(path.join(outputDir, 'manifest.json'));
    for (const item of manifest.weeks) console.log(`W${item.week}: Cargo Van AFS ${item.cargoVanTotalAFS}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
