import { ROLE_PERMISSIONS } from './authorization.mjs';

const FEATURES = [
  ['dashboard', 'Dashboard', '/dashboard', 'executive_dashboard', 'implemented'],
  ['drivers', 'Drivers', '/drivers', 'executive_dashboard', 'implemented'],
  ['fleet_compliance', 'Fleet Compliance', '/fleet-compliance', 'executive_dashboard', 'implemented'],
  ['vans', 'Vans', '/vans', 'executive_dashboard', 'implemented'],
  ['route_monitor', 'Live Route Monitor', '/routes', 'executive_dashboard', 'implemented'],
  ['route_performance', 'Weekly Route Performance', '/route-performance', 'executive_dashboard', 'implemented'],
  ['disputes', 'Dispute Center', '/disputes', 'executive_dashboard', 'implemented'],
  ['payroll', 'Payroll', '/payroll', 'executive_dashboard', 'implemented'],
  ['weekly_evaluation', 'Weekly Evaluation', '/weekly-evaluation', 'executive_dashboard', 'implemented'],
  ['driver_performance', 'Driver Performance', '/performance', 'executive_dashboard', 'implemented'],
  ['connections', 'Connections', '/connections', 'data_integrations', 'implemented', 'integration.manage'],
  ['users', 'Users & Roles', '/users', null, 'implemented', 'member.manage'],
  ['reimbursement_review', 'Reimbursement Review', '/reimbursement-review', 'fixed_monthly', 'implemented'],
  ['time_attendance', 'Time & Attendance', '/time-attendance', 'executive_dashboard', 'implemented'],
  ['fleet_costs', 'Fleet Costs', '/fleet-costs', 'fixed_monthly', 'implemented'],
  ['maintenance', 'Maintenance', '/maintenance', null, 'planned'],
  ['fuel', 'Fuel Tracking', '/fuel', null, 'planned'],
  ['settings', 'Settings', '/settings', null, 'implemented'],
  ['security', 'Security', '/security', null, 'implemented'],
  ['notifications', 'Notifications', '/notifications', null, 'implemented'],
  ['help', 'Help & Support', '/help', null, 'implemented'],
  ['feature_admin', 'Feature Management', '/admin/features', null, 'implemented', 'feature.manage'],
  ['super_admin', 'Tenant Administration', '/admin/tenants', null, 'implemented', 'tenant.manage'],
  ['ai_admin', 'AI Assistant Setup', '/admin/ai', null, 'implemented', 'ai.configure']
];

export const FEATURE_CATALOG = Object.freeze(FEATURES.map(([id, displayName, route, moduleId, status, permission = 'module.read']) =>
  Object.freeze({ id, displayName, route, moduleId, status, permission })
));

export function visibleFeatures({ catalog = FEATURE_CATALOG, entitlements, principal, overrides = [] }) {
  const activeModules = new Set(entitlements.filter((item) => ['active', 'trial'].includes(item.status)).map((item) => item.moduleId));
  const overrideMap = new Map(overrides.map((item) => [item.featureId, item.enabled]));
  return catalog.filter((feature) => {
    if (principal.isPlatformAdmin) return true;
    if (feature.status !== 'implemented') return false;
    if (overrideMap.get(feature.id) === false) return false;
    if (feature.moduleId && !activeModules.has(feature.moduleId)) return false;
    if (!(ROLE_PERMISSIONS[principal.role] || []).includes(feature.permission)) return false;
    return true;
  }).map((feature) => Object.freeze({ ...feature, enabled: overrideMap.get(feature.id) !== false }));
}

export function requireFeatureAccess({ featureId, features, principal }) {
  const feature = features.find((item) => item.id === featureId);
  if (!feature) throw new Error(`feature is unavailable: ${featureId}`);
  if (feature.status !== 'implemented' && !principal.isPlatformAdmin) throw new Error(`feature is not implemented: ${featureId}`);
  if (feature.enabled === false && !principal.isPlatformAdmin) throw new Error(`feature is disabled: ${featureId}`);
  return feature;
}
