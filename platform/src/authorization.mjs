import { moduleById } from './module-registry.mjs';

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(['module.read', 'workflow.run', 'approval.decide', 'submission.execute', 'integration.manage', 'member.manage', 'billing.manage']),
  admin: Object.freeze(['module.read', 'workflow.run', 'approval.decide', 'submission.execute', 'integration.manage', 'member.manage']),
  reviewer: Object.freeze(['module.read', 'workflow.run', 'approval.decide']),
  analyst: Object.freeze(['module.read', 'workflow.run']),
  viewer: Object.freeze(['module.read'])
});

const ACTIVE_ENTITLEMENT_STATES = new Set(['active', 'trial']);

export function assertPrincipal(principal) {
  if (!principal?.userId || !principal?.tenantId) throw new Error('authenticated tenant principal is required');
  if (!ROLE_PERMISSIONS[principal.role]) throw new Error('unknown tenant role');
  return principal;
}

export function requirePermission(principal, permission) {
  assertPrincipal(principal);
  if (!ROLE_PERMISSIONS[principal.role].includes(permission)) throw new Error(`permission denied: ${permission}`);
}

export function requireModuleAccess({ registry, entitlements, principal, moduleId, permission = 'module.read' }) {
  assertPrincipal(principal);
  requirePermission(principal, permission);
  const manifest = moduleById(registry, moduleId);
  const entitlement = entitlements.find((item) => item.moduleId === moduleId && item.tenantId === principal.tenantId);
  if (!entitlement || !ACTIVE_ENTITLEMENT_STATES.has(entitlement.status)) {
    throw new Error(`module is not entitled for tenant: ${moduleId}`);
  }
  if (manifest.status === 'retired') throw new Error(`module is retired: ${moduleId}`);
  return Object.freeze({ manifest, entitlement });
}

export function visibleModules({ registry, entitlements, principal }) {
  assertPrincipal(principal);
  return registry.filter((manifest) => entitlements.some((item) =>
    item.tenantId === principal.tenantId && item.moduleId === manifest.id && ACTIVE_ENTITLEMENT_STATES.has(item.status)
  ));
}
