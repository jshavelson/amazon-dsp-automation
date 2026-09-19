import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODULES_ROOT = path.resolve(HERE, '..', 'modules');
const ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const SKU_PATTERN = /^platform\.[a-z0-9-]{3,64}$/;
const VALID_STATUSES = new Set(['active', 'ready_for_import', 'in_development', 'evidence_blocked', 'retired']);

export function validateModuleManifest(manifest, source = '<memory>') {
  const errors = [];
  if (!ID_PATTERN.test(manifest?.id || '')) errors.push('invalid id');
  if (!SKU_PATTERN.test(manifest?.billingSku || '')) errors.push('invalid billingSku');
  if (!manifest?.displayName) errors.push('displayName is required');
  if (!Number.isInteger(manifest?.version) || manifest.version < 1) errors.push('version must be a positive integer');
  if (!VALID_STATUSES.has(manifest?.status)) errors.push('invalid status');
  if (manifest?.approvalRequired !== true) errors.push('approvalRequired must remain true for external-action modules');
  if (!Array.isArray(manifest?.capabilities) || manifest.capabilities.length === 0) errors.push('capabilities are required');
  if (!Array.isArray(manifest?.dataClasses) || manifest.dataClasses.length === 0) errors.push('dataClasses are required');
  if (errors.length) throw new Error(`${source}: ${errors.join(', ')}`);
  return Object.freeze({ ...manifest });
}

export function loadModuleRegistry(root = DEFAULT_MODULES_ROOT) {
  const manifests = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'module.json'))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => validateModuleManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath));

  const ids = new Set();
  const skus = new Set();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) throw new Error(`duplicate module id: ${manifest.id}`);
    if (skus.has(manifest.billingSku)) throw new Error(`duplicate billing SKU: ${manifest.billingSku}`);
    ids.add(manifest.id);
    skus.add(manifest.billingSku);
  }
  return Object.freeze(manifests.sort((a, b) => a.id.localeCompare(b.id)));
}

export function moduleById(registry, moduleId) {
  const manifest = registry.find((item) => item.id === moduleId);
  if (!manifest) throw new Error(`unknown module: ${moduleId}`);
  return manifest;
}
