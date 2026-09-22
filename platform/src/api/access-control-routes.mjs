import { FEATURE_CATALOG, visibleFeatures } from '../feature-catalog.mjs';
import { requirePermission } from '../authorization.mjs';

const TENANT_ROLES = new Set(['owner', 'admin', 'reviewer', 'analyst', 'viewer']);
const MEMBER_STATUSES = new Set(['invited', 'active', 'disabled']);

export function accessControlRoutes(app, { repository, registry }) {
  app.get('/api/features', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    const overrides = repository.listFeatureOverrides ? await repository.listFeatureOverrides(request.tenantContext) : [];
    const visible = visibleFeatures({ entitlements, principal, overrides });
    return {
      features: principal.isPlatformAdmin
        ? FEATURE_CATALOG.map((feature) => ({ ...feature, enabled: overrides.find((item) => item.featureId === feature.id)?.enabled !== false }))
        : visible,
      canManage: principal.isPlatformAdmin
    };
  });

  app.put('/api/features/:featureId', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'feature.manage');
    const feature = FEATURE_CATALOG.find((item) => item.id === request.params.featureId);
    if (!feature) return reply.code(404).send({ error: 'unknown feature' });
    if (typeof request.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled must be boolean' });
    return { feature: await repository.setFeatureOverride(request.tenantContext, feature.id, request.body.enabled) };
  });

  app.get('/api/members', async (request) => {
    requirePermission(request.tenantContext.principal, 'member.manage');
    return { members: await repository.listMembers(request.tenantContext), roles: [...TENANT_ROLES] };
  });

  app.post('/api/members/invitations', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'member.manage');
    const email = String(request.body?.email || '').trim().toLowerCase();
    const role = String(request.body?.role || 'viewer');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !TENANT_ROLES.has(role)) {
      return reply.code(400).send({ error: 'valid email and tenant role required' });
    }
    if (role === 'owner' && request.tenantContext.principal.role !== 'platform_admin') {
      return reply.code(403).send({ error: 'only a platform admin can invite another owner' });
    }
    try {
      return reply.code(201).send({ member: await repository.inviteMember(request.tenantContext, { email, role }) });
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'that email is already a tenant member' });
      throw error;
    }
  });

  app.put('/api/members/:identitySubject', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'member.manage');
    const role = String(request.body?.role || '');
    const status = String(request.body?.status || '');
    if (!TENANT_ROLES.has(role) || !MEMBER_STATUSES.has(status)) return reply.code(400).send({ error: 'valid role and status required' });
    if ((role === 'owner' || request.params.identitySubject === request.tenantContext.principal.userId) && request.tenantContext.principal.role !== 'platform_admin') {
      return reply.code(403).send({ error: 'platform admin required for owner or self changes' });
    }
    const member = await repository.updateMember(request.tenantContext, request.params.identitySubject, { role, status });
    return member ? { member } : reply.code(404).send({ error: 'member not found' });
  });
}
