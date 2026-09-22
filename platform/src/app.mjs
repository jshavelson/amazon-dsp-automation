import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireModuleAccess, visibleModules } from './authorization.mjs';
import { loadModuleRegistry } from './module-registry.mjs';
import { paveRoutes } from './api/pave-routes.mjs';
import { driverPerformanceRoutes } from './api/driver-performance-routes.mjs';
import { fleetCostsRoutes } from './api/fleet-costs-routes.mjs';
import { disputesRoutes } from './api/disputes-routes.mjs';
import { routeMonitorRoutes } from './api/route-monitor-routes.mjs';
import { payrollRoutes } from './api/payroll-routes.mjs';
import { reactCompatRoutes } from './api/react-compat-routes.mjs';
import { connectionRoutes } from './api/connection-routes.mjs';
import { accessControlRoutes } from './api/access-control-routes.mjs';
import { visibleFeatures } from './feature-catalog.mjs';
import { ROLE_PERMISSIONS } from './authorization.mjs';
import { ImpersonationService } from './impersonation-service.mjs';
import { impersonationRoutes } from './api/impersonation-routes.mjs';
import { assistantRoutes } from './api/assistant-routes.mjs';
import { superAdminRoutes } from './api/super-admin-routes.mjs';

const API_FEATURE_PREFIXES = Object.freeze([
  ['/api/connections', 'connections'], ['/api/uploads', 'connections'], ['/api/vendor-rules', 'connections'],
  ['/api/members', 'users'], ['/api/fleet-compliance', 'fleet_compliance'], ['/api/fleet-costs', 'fleet_costs'],
  ['/api/disputes', 'disputes'], ['/api/payroll', 'payroll'], ['/api/route-monitor', 'route_monitor'], ['/api/routes', 'route_monitor'],
  ['/api/time-attendance', 'time_attendance'],
  ['/api/drivers', 'drivers'], ['/api/pave', 'fleet_compliance'], ['/api/dashboard', 'dashboard']
  ,['/api/assistant/config', 'ai_admin'], ['/api/assistant', 'dashboard'], ['/api/super-admin', 'super_admin']
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function createApp({
  authenticator,
  repository,
  registry = loadModuleRegistry(),
  logger = false,
  authConfig = null,
  dashboardHtmlPath = null,
  disputeSubmission = null,
  connectionService = null,
  assistantService = null,
  memberProvisioner = null,
  impersonationService = new ImpersonationService(),
  exposeLegacyDashboard = true
}) {
  if (!authenticator?.authenticate) throw new Error('authenticator is required');
  if (!repository?.resolveContext) throw new Error('repository is required');
  const identityOrigin = authConfig ? new URL(authConfig.tokenUrl).origin : null;
  const app = Fastify({ logger, trustProxy: false, bodyLimit: 1024 * 1024, requestIdHeader: false });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...(identityOrigin ? [identityOrigin] : [])]
      }
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true }
  });
  await app.register(staticPlugin, {
    root: path.resolve(HERE, '..', 'web'),
    prefix: '/',
    index: false,
    wildcard: false,
    list: false
  });
  const frontendRoot = path.resolve(HERE, '..', 'frontend-dist');
  const frontendAvailable = await fs.access(frontendRoot).then(() => true).catch(() => false);
  if (frontendAvailable) {
    await app.register(staticPlugin, {
      root: frontendRoot,
      prefix: '/app/',
      index: false,
      wildcard: false,
      list: false,
      decorateReply: false
    });
  }

  app.get('/health', async () => ({ status: 'ok' }));
  if (frontendAvailable) {
    app.get('/app', async (_request, reply) => reply.redirect('/app/'));
    app.get('/app/*', async (_request, reply) => reply.sendFile('index.html', frontendRoot));
  }
  
  // Keep the secure Cognito shell at the root. The approved React application
  // is opened at /app/ after authentication, while the incumbent dashboard
  // remains available at /dashboard and /api/dashboard/document.
  app.get('/', async (_request, reply) => reply.sendFile('index.html', path.resolve(HERE, '..', 'web')));

  if (dashboardHtmlPath && exposeLegacyDashboard) {
    // Serve the incumbent dashboard from /dashboard for compatibility.
    app.get('/dashboard', async (_request, reply) => {
      try {
        const document = await fs.readFile(dashboardHtmlPath, 'utf8');
        return reply.type('text/html; charset=utf-8').send(document);
      } catch {
        return reply.code(404).send({ error: 'dashboard unavailable' });
      }
    });
    app.get('/dashboard/', async (_request, reply) => {
      try {
        const document = await fs.readFile(dashboardHtmlPath, 'utf8');
        return reply.type('text/html; charset=utf-8').send(document);
      } catch {
        return reply.code(404).send({ error: 'dashboard unavailable' });
      }
    });
  }
  
  app.get('/auth/config', async () => {
    if (!authConfig) return { enabled: false };
    return {
      enabled: true,
      clientId: authConfig.clientId,
      authorizationUrl: authConfig.authorizationUrl,
      tokenUrl: authConfig.tokenUrl,
      tenantSlug: authConfig.tenantSlug,
      scopes: ['openid', 'email', 'profile']
    };
  });

  app.addHook('onRequest', async (request, reply) => {
    // Every tenant data endpoint requires verified identity and explicit tenant.
    if (!request.url.startsWith('/api/')) return;
    
    try {
      const identity = await authenticator.authenticate(request.headers.authorization);
      const tenantSlug = request.headers['x-tenant-id'];
      if (typeof tenantSlug !== 'string' || !/^[a-z][a-z0-9-]{2,62}$/.test(tenantSlug)) {
        return reply.code(400).send({ error: 'valid x-tenant-id header required' });
      }
      const context = await repository.resolveContext({ tenantSlug, identity });
      if (!context) return reply.code(403).send({ error: 'tenant access denied' });
      const supportToken = request.headers['x-support-session'];
      if (typeof supportToken === 'string') {
        const payload = await impersonationService.verify(supportToken, { actor: context.principal, tenantId: context.principal.tenantId });
        request.tenantContext = Object.freeze({
          ...context,
          principal: Object.freeze({
            ...context.principal,
            userId: String(payload.targetSub), email: String(payload.targetEmail || ''), role: String(payload.targetRole),
            tenantRole: String(payload.targetRole), isPlatformAdmin: false,
            impersonation: Object.freeze({ actor: context.principal, reason: String(payload.reason || ''), expiresAt: Number(payload.exp) * 1000 })
          })
        });
      } else request.tenantContext = context;
    } catch (error) {
      request.log.warn({
        err: error,
        hasAuthorization: typeof request.headers.authorization === 'string',
        hasTenant: typeof request.headers['x-tenant-id'] === 'string'
      }, 'authentication failed');
      return reply.code(401).send({ error: 'authentication failed' });
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/') || !request.tenantContext) return;
    if (request.tenantContext.principal.impersonation && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && request.url !== '/api/support/impersonation/end') {
      return reply.code(403).send({ error: 'support impersonation is read-only' });
    }
    const match = API_FEATURE_PREFIXES.find(([prefix]) => request.url.startsWith(prefix));
    if (!match) return;
    const { principal, entitlements } = request.tenantContext;
    const overrides = repository.listFeatureOverrides ? await repository.listFeatureOverrides(request.tenantContext) : [];
    const allowed = visibleFeatures({ entitlements, principal, overrides }).some((feature) => feature.id === match[1]);
    if (!allowed) return reply.code(403).send({ error: `feature unavailable: ${match[1]}` });
  });

  app.get('/api/context', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    const overrides = repository.listFeatureOverrides ? await repository.listFeatureOverrides(request.tenantContext) : [];
    return {
      tenant: { id: principal.tenantId, name: principal.tenantName },
      user: { id: principal.userId, email: principal.email, role: principal.role, tenantRole: principal.tenantRole, isPlatformAdmin: principal.isPlatformAdmin === true },
      impersonation: principal.impersonation ? { active: true, actorEmail: principal.impersonation.actor.email, targetEmail: principal.email, targetRole: principal.role, reason: principal.impersonation.reason, expiresAt: principal.impersonation.expiresAt } : null,
      permissions: ROLE_PERMISSIONS[principal.role] || [],
      features: visibleFeatures({ entitlements, principal, overrides }),
      modules: visibleModules({ registry, entitlements, principal }).map(({ id, displayName, status, billingSku }) => ({
        id, displayName, status, billingSku
      }))
    };
  });

  app.get('/api/modules/:moduleId/cases', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    requireModuleAccess({ registry, entitlements, principal, moduleId: request.params.moduleId });
    return { cases: await repository.listCases(request.tenantContext, request.params.moduleId) };
  });

  app.get('/api/dashboard/latest', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    requireModuleAccess({ registry, entitlements, principal, moduleId: 'executive_dashboard' });
    return { snapshot: await repository.latestDashboardSnapshot(request.tenantContext) };
  });

  app.get('/api/dashboard/document', async (request, reply) => {
    const { principal, entitlements } = request.tenantContext;
    requireModuleAccess({ registry, entitlements, principal, moduleId: 'executive_dashboard' });
    if (!dashboardHtmlPath) return reply.code(404).send({ error: 'dashboard unavailable' });
    try {
      const document = await fs.readFile(dashboardHtmlPath, 'utf8');
      return reply.type('text/html; charset=utf-8').send(document);
    } catch {
      return reply.code(404).send({ error: 'dashboard unavailable' });
    }
  });

  app.post('/api/disputes/:week/:submissionKey/submit', async (request, reply) => {
    const { principal, entitlements } = request.tenantContext;
    requireModuleAccess({
      registry,
      entitlements,
      principal,
      moduleId: 'executive_dashboard',
      permission: 'submission.execute'
    });
    const { week, submissionKey } = request.params;
    if (!/^2026-W\d{2}$/.test(week) || !/^[A-Za-z0-9._:-]{3,160}$/.test(submissionKey)) {
      return reply.code(400).send({ error: 'invalid dispute candidate' });
    }
    if (request.body?.confirmation !== true) {
      return reply.code(400).send({ error: 'explicit confirmation is required' });
    }
    if (!disputeSubmission?.submit) {
      return reply.code(503).send({ error: 'Amazon dispute submission adapter is unavailable' });
    }
    try {
      const result = await disputeSubmission.submit({
        context: request.tenantContext,
        week,
        submissionKey,
        requestId: request.id
      });
      return reply.code(result.alreadySubmitted ? 200 : 201).send(result);
    } catch (error) {
      if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/integrations', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    requireModuleAccess({ registry, entitlements, principal, moduleId: 'data_integrations' });
    return { connections: await repository.listIntegrationConnections(request.tenantContext) };
  });

  connectionRoutes(app, { connectionService });
  accessControlRoutes(app, { repository, registry, memberProvisioner });
  impersonationRoutes(app, { repository, impersonationService });
  assistantRoutes(app, { assistantService });
  superAdminRoutes(app, { repository, memberProvisioner, impersonationService, registry });

  // Register PAVE routes
  paveRoutes(app, { repository, registry, logger });

  // Register Driver Performance routes
  driverPerformanceRoutes(app, { repository, registry, logger });

  // Register Fleet Costs routes
  fleetCostsRoutes(app, { repository, registry, logger });

  // Register Disputes routes
  disputesRoutes(app, { repository, registry, logger });

  // Register Route Monitor routes
  routeMonitorRoutes(app, { repository, registry, logger });

  // Register Payroll routes
  payrollRoutes(app, { repository, registry, logger });

  // React application compatibility endpoints backed by the tenant repository.
  reactCompatRoutes(app, { repository, dashboardHtmlPath, logger, connectionService, includeConnectionSnapshot: !connectionService });

  app.setErrorHandler((error, request, reply) => {
    request.log?.warn({ err: error, requestId: request.id }, 'request failed');
    if (/permission denied|not entitled|unknown module|retired/.test(error.message)) {
      return reply.code(403).send({ error: 'access denied' });
    }
    return reply.code(500).send({ error: 'internal error', requestId: request.id });
  });
  return app;
}
