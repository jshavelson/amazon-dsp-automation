import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export async function launchAmazonPersistentContext({ root, config, headless = true, acceptDownloads = false }) {
  const profileDir = path.join(root, '.openclaw', 'browser-profiles', 'amazon-logistics');
  const storageStatePath = path.resolve(root, config.storageStatePath);
  const seededMarker = path.join(profileDir, '.portable-state-seeded');
  await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless, acceptDownloads, viewport: { width: 1440, height: 1000 }
  });
  const alreadySeeded = await fs.access(seededMarker).then(() => true).catch(() => false);
  if (!alreadySeeded) {
    const state = await fs.readFile(storageStatePath, 'utf8').then(JSON.parse).catch(() => null);
    if (state?.cookies?.length) await context.addCookies(state.cookies);
    await fs.writeFile(seededMarker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  }
  return { context, profileDir, storageStatePath };
}

export async function saveAmazonPortableState(context, storageStatePath) {
  const temporaryState = `${storageStatePath}.refreshing`;
  await context.storageState({ path: temporaryState });
  await fs.chmod(temporaryState, 0o600);
  await fs.rename(temporaryState, storageStatePath);
  await fs.chmod(storageStatePath, 0o600);
}
