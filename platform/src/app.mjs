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

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function createApp({
  authenticator,
  repository,
  registry = loadModuleRegistry(),
  logger = false,
  authConfig = null,
  dashboardHtmlPath = null,
  disputeSubmission = null
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

  if (dashboardHtmlPath) {
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

  // List of public API endpoints that don't require authentication (for dashboard)
  const PUBLIC_API_ENDPOINTS = [
    '/api/driver-performance',
    '/api/fleet-optimization',
    '/api/fleet-costs',
    '/api/route-monitor',
    '/api/payroll',
    '/api/payroll/discrepancies',
    '/api/disputes',
    '/api/disputes/candidates',
    '/api/pave/vehicles',
    '/api/pave/compliance-report',
    '/api/pave/inspections'
  ];

  app.addHook('onRequest', async (request, reply) => {
    // Skip authentication for public dashboard API endpoints
    const path = request.url.split('?')[0];
    const isPublicEndpoint = request.method === 'GET' && PUBLIC_API_ENDPOINTS.some(endpoint => 
      path === endpoint || path.startsWith(endpoint + '/')
    );
    
    if (isPublicEndpoint) {
      // For public endpoints, create a minimal context
      request.tenantContext = {
        principal: { tenantId: 'jecs', tenantName: 'JEC Logistics Solutions', userId: 'dashboard-user', email: 'dashboard@jecs.com', role: 'viewer' },
        entitlements: []
      };
      return;
    }
    
    // For all other API endpoints, require authentication
    if (!request.url.startsWith('/api/')) return;
    
    try {
      const identity = await authenticator.authenticate(request.headers.authorization);
      const tenantSlug = request.headers['x-tenant-id'];
      if (typeof tenantSlug !== 'string' || !/^[a-z][a-z0-9-]{2,62}$/.test(tenantSlug)) {
        return reply.code(400).send({ error: 'valid x-tenant-id header required' });
      }
      const context = await repository.resolveContext({ tenantSlug, identity });
      if (!context) return reply.code(403).send({ error: 'tenant access denied' });
      request.tenantContext = context;
    } catch {
      return reply.code(401).send({ error: 'authentication failed' });
    }
  });

  app.get('/api/context', async (request) => {
    const { principal, entitlements } = request.tenantContext;
    return {
      tenant: { id: principal.tenantId, name: principal.tenantName },
      user: { id: principal.userId, email: principal.email, role: principal.role },
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
      return reply.code(403).send({ error: 'explicit confirmation is required' });
    }
    if (!disputeSubmission?.submit) {
      return reply.code(403).send({ error: 'Amazon dispute submission adapter is unavailable' });
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

  // Register PAVE routes
  paveRoutes(app, { repository, logger });

  // Register Driver Performance routes
  driverPerformanceRoutes(app, { repository, logger });

  // Register Fleet Costs routes
  fleetCostsRoutes(app, { repository, logger });

  // Register Disputes routes
  disputesRoutes(app, { repository, logger });

  // Register Route Monitor routes
  routeMonitorRoutes(app, { repository, logger });

  // Register Payroll routes
  payrollRoutes(app, { repository, logger });

  // React application compatibility endpoints backed by the tenant repository.
  reactCompatRoutes(app, { repository, dashboardHtmlPath, logger });

  app.setErrorHandler((error, request, reply) => {
    request.log?.warn({ err: error, requestId: request.id }, 'request failed');
    if (/permission denied|not entitled|unknown module|retired/.test(error.message)) {
      return reply.code(403).send({ error: 'access denied' });
    }
    return reply.code(500).send({ error: 'internal error', requestId: request.id });
  });
  return app;
}
