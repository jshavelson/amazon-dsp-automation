import path from 'node:path';

const TENANT_ID = /^[a-z][a-z0-9-]{2,62}$/;

export function tenantArtifactPath(root, tenantId, ...segments) {
  if (!TENANT_ID.test(tenantId || '')) throw new Error('invalid tenant id');
  for (const segment of segments) {
    if (typeof segment !== 'string' || !segment || segment.includes('\0')) throw new Error('invalid path segment');
    if (path.isAbsolute(segment)) throw new Error('absolute paths are denied');
  }
  const tenantRoot = path.resolve(root, tenantId);
  const result = path.resolve(tenantRoot, ...segments);
  if (result !== tenantRoot && !result.startsWith(`${tenantRoot}${path.sep}`)) throw new Error('tenant path escape denied');
  return result;
}
