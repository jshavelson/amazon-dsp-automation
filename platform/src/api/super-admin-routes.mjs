import { requirePermission } from '../authorization.mjs';
import { FEATURE_CATALOG } from '../feature-catalog.mjs';
import fs from 'node:fs/promises';

const SLUG = /^[a-z][a-z0-9-]{2,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[a-z][a-z0-9_]{2,63}$/;
const AUTH_KINDS = new Set(['api_credentials', 'browser_session', 'imap_password', 'manual_upload']);
const CONNECTION_STATUSES = new Set(['pending', 'healthy', 'degraded', 'needs_reauth', 'disabled']);
const FORBIDDEN_CONFIG_KEYS = /password|secret|token|credential|private.?key|api.?key/i;

function requirePlatformAdmin(request, permission) {
  const principal = request.tenantContext.principal;
  requirePermission(principal, permission);
  if (!principal.isPlatformAdmin) throw new Error('platform administrator required');
  return principal;
}

function cleanText(value, max = 100) {
  const text = String(value || '').trim();
  return text && text.length <= max ? text : null;
}

function containsSecretField(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_CONFIG_KEYS.test(key) || containsSecretField(child));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function assertTenantSlug(value) {
  const slug = String(value || '');
  if (!SLUG.test(slug)) throw new Error('invalid tenant slug');
  return slug;
}

export function superAdminRoutes(app, { repository, memberProvisioner, impersonationService, registry = [] }) {
  app.get('/api/super-admin/tenants', async (request) => {
    requirePlatformAdmin(request, 'tenant.manage');
    return {
      tenants: await repository.listAllTenants(),
      modules: registry.map(({ id, displayName, status }) => ({ id, displayName, status }))
    };
  });

  app.post('/api/super-admin/tenants', async (request, reply) => {
    const principal = requirePlatformAdmin(request, 'tenant.provision');
    const body = request.body || {};
    const slug = String(body.slug || '').trim();
    const displayName = cleanText(body.displayName);
    const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
    const ownerGivenName = cleanText(body.ownerGivenName, 60);
    const ownerFamilyName = cleanText(body.ownerFamilyName, 60);
    const knownModules = new Set(registry.map((item) => item.id));
    const moduleIds = [...new Set(Array.isArray(body.moduleIds) ? body.moduleIds.map(String) : [])];
    if (!SLUG.test(slug)) return reply.code(400).send({ error: 'tenant slug must be 3-63 lowercase letters, numbers, or hyphens and start with a letter' });
    if (!displayName) return reply.code(400).send({ error: 'display name is required and must be 100 characters or fewer' });
    if (!EMAIL.test(ownerEmail)) return reply.code(400).send({ error: 'valid owner email is required' });
    if (!ownerGivenName || !ownerFamilyName) return reply.code(400).send({ error: 'owner first and last name are required' });
    if (moduleIds.some((id) => !knownModules.has(id))) return reply.code(400).send({ error: 'one or more module selections are invalid' });
    if (await repository.getTenantBySlug(slug)) return reply.code(409).send({ error: 'tenant slug already exists' });

    let identity = { identitySubject: null, invitationSent: false };
    if (memberProvisioner) {
      identity = await memberProvisioner.invite({
        email: ownerEmail, givenName: ownerGivenName, familyName: ownerFamilyName,
        tenantId: slug, role: 'owner'
      });
    }
    try {
      const result = await repository.provisionTenant({
        slug, displayName, ownerEmail, ownerIdentitySubject: identity.identitySubject,
        moduleIds, actor: principal
      });
      return reply.code(201).send({
        ...result,
        owner: { ...result.owner, invitationSent: identity.invitationSent === true }
      });
    } catch (error) {
      if (error?.code === '23505' || /already exists|duplicate/i.test(error?.message || '')) {
        return reply.code(409).send({ error: 'tenant slug or owner membership already exists' });
      }
      throw error;
    }
  });

  app.get('/api/super-admin/tenants/:tenantSlug', async (request, reply) => {
    requirePlatformAdmin(request, 'tenant.manage');
    const tenant = await repository.getTenantDetails(assertTenantSlug(request.params.tenantSlug));
    return tenant ? { tenant } : reply.code(404).send({ error: 'tenant not found' });
  });

  app.put('/api/super-admin/tenants/:tenantSlug/status', async (request, reply) => {
    const principal = requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = assertTenantSlug(request.params.tenantSlug);
    const status = String(request.body?.status || '');
    if (!['active', 'suspended', 'closed'].includes(status)) return reply.code(400).send({ error: 'status must be active, suspended, or closed' });
    const tenant = await repository.updateTenantStatus(tenantSlug, status, principal);
    return tenant ? { tenant } : reply.code(404).send({ error: 'tenant not found' });
  });

  app.get('/api/super-admin/tenants/:tenantSlug/features', async (request, reply) => {
    requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = assertTenantSlug(request.params.tenantSlug);
    if (!await repository.getTenantBySlug(tenantSlug)) return reply.code(404).send({ error: 'tenant not found' });
    const overrides = await repository.listTenantFeatures(tenantSlug);
    const overrideMap = new Map(overrides.map((item) => [item.featureId, item]));
    return {
      tenantSlug,
      features: FEATURE_CATALOG.filter((item) => item.status === 'implemented').map((feature) => ({
        ...feature,
        enabled: overrideMap.get(feature.id)?.enabled !== false,
        overridden: overrideMap.has(feature.id)
      }))
    };
  });

  app.put('/api/super-admin/tenants/:tenantSlug/features/:featureId', async (request, reply) => {
    const principal = requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = assertTenantSlug(request.params.tenantSlug);
    const featureId = String(request.params.featureId || '');
    if (!FEATURE_CATALOG.some((item) => item.id === featureId && item.status === 'implemented')) return reply.code(404).send({ error: 'feature not found' });
    if (typeof request.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled must be a boolean' });
    const feature = await repository.setTenantFeatureOverride(tenantSlug, featureId, request.body.enabled, principal);
    return feature ? { tenantSlug, feature } : reply.code(404).send({ error: 'tenant not found' });
  });

  app.get('/api/super-admin/tenants/:tenantSlug/connections', async (request, reply) => {
    requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = assertTenantSlug(request.params.tenantSlug);
    if (!await repository.getTenantBySlug(tenantSlug)) return reply.code(404).send({ error: 'tenant not found' });
    return { tenantSlug, connections: await repository.listTenantConnections(tenantSlug) };
  });

  app.post('/api/super-admin/tenants/:tenantSlug/connections', async (request, reply) => {
    const principal = requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = assertTenantSlug(request.params.tenantSlug);
    const integrationType = String(request.body?.integrationType || '').trim();
    const displayName = cleanText(request.body?.displayName);
    const authKind = String(request.body?.authKind || 'manual_upload');
    const status = String(request.body?.status || 'pending');
    const schedule = cleanText(request.body?.schedule, 120);
    const config = request.body?.config || {};
    if (!ID.test(integrationType) || !displayName) return reply.code(400).send({ error: 'valid integration type and display name are required' });
    if (!AUTH_KINDS.has(authKind) || !CONNECTION_STATUSES.has(status)) return reply.code(400).send({ error: 'invalid authentication kind or status' });
    if (containsSecretField(config) || request.body?.secretReference || request.body?.credentials) {
      return reply.code(400).send({ error: 'credential values and secret references must be configured through the tenant vault workflow' });
    }
    try {
      const connection = await repository.createTenantConnection(tenantSlug, {
        integrationType, displayName, authKind, status, schedule, config
      }, principal);
      return reply.code(201).send({ connection });
    } catch (error) {
      if (error?.code === '23505' || /already exists|duplicate/i.test(error?.message || '')) return reply.code(409).send({ error: 'connection already exists' });
      if (/tenant not found/i.test(error?.message || '')) return reply.code(404).send({ error: 'tenant not found' });
      throw error;
    }
  });

  app.get('/api/super-admin/members', async (request) => {
    requirePlatformAdmin(request, 'tenant.manage');
    const tenantSlug = request.query?.tenantSlug ? assertTenantSlug(request.query.tenantSlug) : null;
    return repository.listAllMembers({
      tenantSlug,
      limit: boundedInteger(request.query?.limit, 100, 1, 200),
      offset: boundedInteger(request.query?.offset, 0, 0, 100_000)
    });
  });

  app.post('/api/super-admin/impersonate', async (request, reply) => {
    const principal = requirePlatformAdmin(request, 'tenant.impersonate');
    const tenantSlug = assertTenantSlug(request.body?.tenantSlug);
    const targetSubject = String(request.body?.targetSubject || '');
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return reply.code(400).send({ error: 'reason must be 10-500 characters' });
    const members = await repository.listTenantMembers(tenantSlug);
    const target = members.find((item) => item.identitySubject === targetSubject && item.status === 'active');
    if (!target) return reply.code(404).send({ error: 'active target user not found in tenant' });
    const session = await impersonationService.create({
      actor: principal, tenantId: tenantSlug, target, reason, durationMinutes: request.body?.durationMinutes
    });
    await repository.auditPlatformEvent(principal, 'impersonation.cross_tenant', 'user', target.identitySubject, {
      tenantSlug, targetEmail: target.email, targetRole: target.role, reason,
      expiresInSeconds: session.expiresInSeconds
    });
    return reply.code(201).send({ ...session, target: { email: target.email, role: target.role, tenantSlug } });
  });

  app.get('/api/super-admin/onboarding-checklist', async (request) => {
    requirePlatformAdmin(request, 'tenant.manage');
    return {
      checklist: {
        sections: [
          { id: 'company', label: 'Company and station information', required: true },
          { id: 'owner', label: 'Initial tenant owner identity', required: true },
          { id: 'fleet', label: 'Fleet roster, ownership, registration, and maintenance baseline', required: true },
          { id: 'drivers', label: 'Driver roster, employment status, and payroll identifiers', required: true },
          { id: 'amazon', label: 'Amazon DSP identifiers and secure session handoff', required: true },
          { id: 'payroll', label: 'ADP/API connection or approved payroll export', required: true },
          { id: 'accounting', label: 'Digits, QuickBooks, or CSV accounting source', required: false },
          { id: 'policies', label: 'Feature access, reporting timezone, and approval contacts', required: true }
        ],
        credentialNotice: 'Collect credentials only through the tenant vault or secure reconnect flow. Never place credential values in onboarding forms, chat, email, or tenant records.',
        documentPath: '/platform/docs/tenant-onboarding-checklist.pdf'
      }
    };
  });

  app.get('/api/super-admin/onboarding-checklist.pdf', async (request, reply) => {
    requirePlatformAdmin(request, 'tenant.manage');
    const document = await fs.readFile(new URL('../../docs/tenant-onboarding-checklist.pdf', import.meta.url));
    return reply.type('application/pdf').header('Content-Disposition', 'attachment; filename="tenant-onboarding-checklist.pdf"').send(document);
  });
}
