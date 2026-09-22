import { FEATURE_CATALOG, visibleFeatures } from '../feature-catalog.mjs';
import { requirePermission } from '../authorization.mjs';

const TENANT_ROLES = new Set(['owner', 'admin', 'reviewer', 'analyst', 'viewer']);
const MEMBER_STATUSES = new Set(['invited', 'active', 'disabled']);

export function accessControlRoutes(app, { repository, registry, memberProvisioner = null }) {
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
    const givenName = String(request.body?.givenName || '').trim();
    const familyName = String(request.body?.familyName || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !TENANT_ROLES.has(role) || !givenName || !familyName) {
      return reply.code(400).send({ error: 'first name, last name, valid email, and tenant role are required' });
    }
    if (role === 'owner' && request.tenantContext.principal.role !== 'platform_admin') {
      return reply.code(403).send({ error: 'only a platform admin can invite another owner' });
    }
    try {
      const existing = await repository.listMembers(request.tenantContext);
      if (existing.some((member) => member.email?.toLowerCase() === email)) {
        return reply.code(409).send({ error: 'that email is already a tenant member' });
      }
      const identity = memberProvisioner
        ? await memberProvisioner.invite({ email, givenName, familyName, tenantId: request.tenantContext.principal.tenantId, role })
        : { identitySubject: null, invitationSent: false };
      const member = await repository.inviteMember(request.tenantContext, { email, role, identitySubject: identity.identitySubject });
      return reply.code(201).send({ member, invitationSent: identity.invitationSent });
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'that email is already a tenant member' });
      if (error.name === 'LimitExceededException' || error.name === 'TooManyRequestsException') {
        return reply.code(429).send({ error: 'invitation delivery is temporarily rate limited; try again shortly' });
      }
      throw error;
    }
  });

  app.post('/api/members/:identitySubject/resend-invitation', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'member.manage');
    if (!memberProvisioner) return reply.code(503).send({ error: 'invitation delivery is not configured' });
    const members = await repository.listMembers(request.tenantContext);
    const member = members.find((item) => item.identitySubject === request.params.identitySubject);
    if (!member) return reply.code(404).send({ error: 'member not found' });
    if (member.status !== 'invited') return reply.code(409).send({ error: 'only pending invitations can be resent' });
    try {
      await memberProvisioner.resend({ email: member.email });
      if (repository.auditMemberInvitationResent) {
        await repository.auditMemberInvitationResent(request.tenantContext, member);
      }
      return { member, invitationSent: true };
    } catch (error) {
      if (error.name === 'UserNotFoundException') return reply.code(404).send({ error: 'the invited identity no longer exists' });
      if (error.name === 'NotAuthorizedException') return reply.code(409).send({ error: 'this user has already completed the invitation' });
      if (error.name === 'LimitExceededException' || error.name === 'TooManyRequestsException') {
        return reply.code(429).send({ error: 'invitation delivery is temporarily rate limited; try again shortly' });
      }
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
