import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { ImpersonationService } from '../src/impersonation-service.mjs';

const authenticator = {
  async authenticate(value) {
    if (!value || !value.startsWith('Bearer ')) throw new Error('invalid token');
    return { subject: 'user-1', email: 'owner@example.com' };
  }
};

const registry = [
  { id: 'executive_dashboard', displayName: 'Executive Operations Dashboard', billingSku: 'platform.executive-dashboard', version: 1, status: 'active', approvalRequired: true, capabilities: ['executive_kpis'], dataClasses: ['scorecard'] },
  { id: 'data_integrations', displayName: 'Data Integrations', billingSku: 'platform.data-integrations', version: 1, status: 'active', approvalRequired: true, capabilities: ['data_import'], dataClasses: ['scorecard'] },
  { id: 'fixed_monthly', displayName: 'Fixed Monthly', billingSku: 'platform.fixed-monthly', version: 1, status: 'active', approvalRequired: true, capabilities: ['reconciliation'], dataClasses: ['payments'] },
  { id: 'fif_reimbursements', displayName: 'FIF Reimbursements', billingSku: 'platform.fif-reimbursements', version: 1, status: 'active', approvalRequired: true, capabilities: ['reimbursement'], dataClasses: ['fif'] },
  { id: 'fifth_day_overtime', displayName: 'Fifth Day Overtime', billingSku: 'platform.fifth-day-overtime', version: 1, status: 'active', approvalRequired: true, capabilities: ['payroll'], dataClasses: ['overtime'] },
  { id: 'weekly_payments', displayName: 'Weekly Variable + Incentive', billingSku: 'platform.weekly-payments', version: 1, status: 'active', approvalRequired: true, capabilities: ['reconciliation'], dataClasses: ['payroll'] },
  { id: 'capacity_reliability', displayName: 'Capacity + Reliability', billingSku: 'platform.capacity-reliability', version: 1, status: 'active', approvalRequired: true, capabilities: ['operations'], dataClasses: ['scorecard'] }
];

const repository = {
  async resolveContext({ tenantSlug, identity }) {
    if (tenantSlug !== 'jec-logistics') return null;
    return {
      principal: { userId: identity.subject, tenantId: tenantSlug, tenantDbId: 'db-1', tenantName: 'JEC Logistics', role: 'owner', email: identity.email },
      entitlements: [
        { tenantId: tenantSlug, moduleId: 'executive_dashboard', status: 'active' },
        { tenantId: tenantSlug, moduleId: 'data_integrations', status: 'active' },
        { tenantId: tenantSlug, moduleId: 'fixed_monthly', status: 'active' }
      ]
    };
  },
  async listCases(_context, moduleId) { return [{ id: 'case-1', module_id: moduleId }]; },
  async latestDashboardSnapshot() { return { period_key: '2026-W37', stale_sources: [] }; },
  async listIntegrationConnections() { return [{ id: 'connection-1', integration_type: 'adp', status: 'healthy' }]; }
  ,async listLiveRoutes() { return { items: [{
    routeId: 'route-1', routeCode: 'CX101', deliveryDate: '2026-09-22', transporterId: 'A123',
    driverName: 'Example Driver', vin: 'VIN123', status: 'in_progress', risk: 'behind',
    completedStops: 42, totalStops: 100, completionPct: 42, deliveredPackages: 95, totalPackages: 220,
    stopsLastHour: 8, projectedCompletionAt: '2026-09-22T23:00:00Z', projectedLateMinutes: 25,
    inactiveMinutes: 5, onBreak: false, routePaused: false, rescueCount: 0,
    associatedRoutes: [{ routeCode: 'CX101' }], isMultiRoute: false, capturedAt: new Date().toISOString()
  }], total: 1 }; }
  ,async listAttendanceExceptions() {
    return {
      startDate: '2026-09-13', endDate: '2026-09-19', capturedAt: '2026-09-20T01:00:00Z',
      employees: 26, dailyAssignments: 0, routeReconciliationAvailable: false,
      items: [{ employee: 'Example Driver', date: '2026-09-15', issueType: 'Long shift', details: '10.25 hours' }]
    };
  }
  ,async listFeatureOverrides() { return []; }
  ,async listMembers() { return [{ identitySubject: 'user-1', email: 'owner@example.com', role: 'owner', status: 'active' }]; }
  ,async inviteMember(_context, value) { return { identitySubject: 'invited:1', ...value, status: 'invited' }; }
  ,async updateMember(_context, identitySubject, value) { return { identitySubject, email: 'member@example.com', ...value }; }
  ,async setFeatureOverride(_context, featureId, enabled) { return { featureId, enabled }; }
};

test('health and public shell do not require tenant credentials', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const shell = await app.inject({ method: 'GET', url: '/' });
  assert.equal(shell.statusCode, 200);
  assert.match(shell.body, /Tenant data and dashboard documents are returned only after verified sign-in/);
});

test('legacy dashboard compatibility route serves the packaged document', async (t) => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsp-dashboard-test-'));
  const dashboardHtmlPath = path.join(tempDirectory, 'dashboard.html');
  await fs.writeFile(dashboardHtmlPath, '<!doctype html><title>Compatibility dashboard</title>');
  const app = await createApp({ authenticator, repository, registry, dashboardHtmlPath, exposeLegacyDashboard: true });
  t.after(async () => {
    await app.close();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });
  const response = await app.inject({ method: 'GET', url: '/dashboard' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.match(response.body, /Compatibility dashboard/);
});

test('protected API requires bearer identity and explicit tenant', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/api/context' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/context', headers: { authorization: 'Bearer test' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/context', headers: { authorization: 'Bearer test', 'x-tenant-id': 'other-dsp' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/fleet-costs' })).statusCode, 401);
});

test('authenticated React session endpoint returns the current tenant user', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().email, 'owner@example.com');
  assert.equal(response.json().role, 'dsp_owner');
});

test('a non-reference tenant never receives the reference tenant operational snapshots', async (t) => {
  const isolatedRepository = {
    ...repository,
    async resolveContext({ tenantSlug, identity }) {
      if (tenantSlug !== 'funk') return null;
      return {
        principal: { userId: identity.subject, tenantId: 'funk', tenantDbId: 'db-funk', tenantName: 'Funk', role: 'platform_admin', email: identity.email, isPlatformAdmin: true },
        entitlements: [
          { tenantId: 'funk', moduleId: 'executive_dashboard', status: 'active' },
          { tenantId: 'funk', moduleId: 'fixed_monthly', status: 'active' }
        ]
      };
    }
  };
  const app = await createApp({
    authenticator, repository: isolatedRepository, registry,
    authConfig: { clientId: 'client', authorizationUrl: 'https://identity.example/authorize', tokenUrl: 'https://identity.example/token', tenantSlug: 'jec-logistics' }
  });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'funk' };
  const operations = await app.inject({ method: 'GET', url: '/api/dashboard/operations', headers });
  assert.equal(operations.statusCode, 200);
  assert.equal(operations.json().tenant.name, 'Funk');
  assert.equal(operations.json().needsData, true);
  assert.deepEqual(operations.json().performance.history, []);
  assert.deepEqual(operations.json().fleet.vehicles, []);
  assert.deepEqual(operations.json().costs.charges, []);

  const compliance = await app.inject({ method: 'GET', url: '/api/fleet-compliance', headers });
  assert.equal(compliance.statusCode, 200);
  assert.equal(compliance.json().needsData, true);
  assert.deepEqual(compliance.json().vehicles, []);

  const evaluations = await app.inject({ method: 'GET', url: '/api/weekly-evaluations', headers });
  assert.equal(evaluations.statusCode, 200);
  assert.deepEqual(evaluations.json().weeks, []);

  const performance = await app.inject({ method: 'GET', url: '/api/performance/dashboard', headers });
  assert.equal(performance.statusCode, 200);
  assert.equal(performance.json().needsData, true);
  assert.deepEqual(performance.json().drivers, []);

  const routePerformance = await app.inject({ method: 'GET', url: '/api/route-performance', headers });
  assert.equal(routePerformance.statusCode, 200);
  assert.equal(routePerformance.json().needsData, true);
  assert.deepEqual(routePerformance.json().routes, []);

  const disputes = await app.inject({ method: 'GET', url: '/api/disputes', headers });
  assert.equal(disputes.statusCode, 200);
  assert.deepEqual(disputes.json(), []);

  const candidates = await app.inject({ method: 'GET', url: '/api/disputes/candidates', headers });
  assert.equal(candidates.statusCode, 200);
  assert.deepEqual(candidates.json(), []);

  const modules = await app.inject({ method: 'GET', url: '/api/modules', headers });
  assert.equal(modules.statusCode, 200);
  assert.equal(modules.json().needsData, true);
  assert.deepEqual(modules.json().cases, []);
});

test('operations dashboard is assembled from connected scorecard and operational sources', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/dashboard/operations',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.match(payload.performance.period, /^\d{4}-wk\d{2}$/);
  assert.ok(payload.performance.drivers.length > 0);
  assert.ok(payload.performance.history.length > 0);
  assert.ok(payload.sources.some((source) => source.id === 'amazon'));
});

test('time and attendance returns tenant-scoped ADP exceptions and honest route coverage', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/time-attendance/exceptions',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.sourcePeriod, '2026-09-13 to 2026-09-19');
  assert.equal(payload.coverage.employees, 26);
  assert.equal(payload.coverage.routeReconciliationAvailable, false);
  assert.equal(payload.exceptions[0].issueType, 'Long shift');
  assert.match(payload.message, /route-based exceptions are withheld/);
});

test('live route monitor returns only same-day execution data with freshness and exception summary', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/route-monitor',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(Array.isArray(payload), false);
  assert.equal(Array.isArray(payload.routes), true);
  assert.equal(payload.routes.length, 1);
  assert.equal(payload.routeCount, payload.routes.length);
  assert.equal(payload.source, 'Amazon Delivery Execution');
  assert.equal(payload.summary.behind, 1);
  assert.equal(payload.needsData, false);
});

test('weekly route performance remains available on a separately named endpoint', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/route-performance', headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' } });
  assert.equal(response.statusCode, 200);
  assert.match(response.json().source, /scorecard/i);
  assert.ok(response.json().routes.length > 0);
});

test('vans returns the paginated contract with the packaged fleet roster when the van table is unavailable', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/vans',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(Array.isArray(payload.data), true);
  assert.ok(payload.data.length >= 40);
  assert.equal(payload.meta.totalItems, payload.data.length);
  assert.ok(payload.data.every((van) => van.vin && van.van_number && van.status && van.ownership));
});

test('payroll returns a needs-data contract instead of HTTP 500 when its table is unavailable', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/payroll',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().needsData, true);
  assert.deepEqual(response.json().timecards, []);
});

test('implemented header destinations are present in the visible feature context', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET', url: '/api/context',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' }
  });
  assert.equal(response.statusCode, 200);
  const routes = response.json().features.map((feature) => feature.route);
  assert.ok(routes.includes('/notifications'));
  assert.ok(routes.includes('/security'));
});

test('assistant is tenant-authenticated and fails closed when no platform model is configured', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  assert.equal((await app.inject({ method: 'GET', url: '/api/assistant/status' })).statusCode, 401);
  const status = await app.inject({ method: 'GET', url: '/api/assistant/status', headers });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().configured, false);
  const chat = await app.inject({ method: 'POST', url: '/api/assistant/chat', headers, payload: { message: 'Summarize risk' } });
  assert.equal(chat.statusCode, 503);
});

test('connection broker is owner-gated and never returns submitted credentials', async (t) => {
  const calls = [];
  const connectionService = {
    async list(context) {
      calls.push(['list', context.principal.tenantId]);
      return { tenant: context.principal.tenantId, connections: [] };
    },
    async configure(_context, id, body) {
      calls.push(['configure', id, body.credentials.clientSecret]);
      return {
        id,
        configured: true,
        status: 'pending',
        secretReference: 'secret://jec-logistics/aws/digits-api/credentials'
      };
    },
    async test() { return { status: 'healthy' }; }
  };
  const app = await createApp({ authenticator, repository, registry, connectionService });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  assert.equal((await app.inject({ method: 'GET', url: '/api/connections', headers })).statusCode, 200);
  const response = await app.inject({
    method: 'PUT',
    url: '/api/connections/digits_api/credentials',
    headers,
    payload: {
      environment: 'development',
      credentials: { clientId: 'client-value', clientSecret: 'never-return-this' }
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('never-return-this'), false);
  assert.equal(response.json().connection.secretReference, 'secret://jec-logistics/aws/digits-api/credentials');
  assert.equal(calls[1][2], 'never-return-this');
});

test('context exposes only entitled modules and case route enforces module access', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' };
  const context = await app.inject({ method: 'GET', url: '/api/context', headers });
  assert.equal(context.statusCode, 200);
  assert.deepEqual(context.json().modules.map((item) => item.id).sort(), ['data_integrations', 'executive_dashboard', 'fixed_monthly']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/modules/fixed_monthly/cases', headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/modules/weekly_payments/cases', headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/dashboard/latest', headers })).json().snapshot.period_key, '2026-W37');
  const integrations = await app.inject({ method: 'GET', url: '/api/integrations', headers });
  assert.equal(integrations.json().connections[0].integration_type, 'adp');
});

test('tenant owner can manage users but cannot manage platform feature flags', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  const members = await app.inject({ method: 'GET', url: '/api/members', headers });
  assert.equal(members.statusCode, 200);
  assert.equal(members.json().members[0].role, 'owner');
  const invited = await app.inject({ method: 'POST', url: '/api/members/invitations', headers, payload: { email: 'analyst@example.com', givenName: 'Alex', familyName: 'Analyst', role: 'analyst' } });
  assert.equal(invited.statusCode, 201);
  assert.equal(invited.json().member.status, 'invited');
  const featureUpdate = await app.inject({ method: 'PUT', url: '/api/features/dashboard', headers, payload: { enabled: false } });
  assert.equal(featureUpdate.statusCode, 403);
});

test('add user provisions Cognito identity before creating tenant membership', async (t) => {
  const calls = [];
  const provisionedRepository = {
    ...repository,
    async inviteMember(_context, value) { calls.push(['membership', value]); return { ...value, status: 'invited' }; }
  };
  const memberProvisioner = {
    async invite(value) { calls.push(['identity', value]); return { identitySubject: 'cognito-sub-1', invitationSent: true }; }
  };
  const app = await createApp({ authenticator, repository: provisionedRepository, registry, memberProvisioner });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/members/invitations',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' },
    payload: { email: 'new.user@example.com', givenName: 'New', familyName: 'User', role: 'viewer' }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().invitationSent, true);
  assert.deepEqual(calls.map(([kind]) => kind), ['identity', 'membership']);
  assert.equal(calls[1][1].identitySubject, 'cognito-sub-1');
});

test('tenant admin can resend only a pending member invitation and the action is audited', async (t) => {
  const calls = [];
  const invitedMember = { identitySubject: 'cognito-sub-1', email: 'analyst@example.com', role: 'analyst', status: 'invited' };
  const resendRepository = {
    ...repository,
    async listMembers() { return [invitedMember, { ...invitedMember, identitySubject: 'active-sub', email: 'active@example.com', status: 'active' }]; },
    async auditMemberInvitationResent(_context, member) { calls.push(['audit', member.email]); }
  };
  const memberProvisioner = {
    async resend({ email }) { calls.push(['resend', email]); return { invitationSent: true }; }
  };
  const app = await createApp({ authenticator, repository: resendRepository, registry, memberProvisioner });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics' };
  const resent = await app.inject({ method: 'POST', url: '/api/members/cognito-sub-1/resend-invitation', headers });
  assert.equal(resent.statusCode, 200);
  assert.equal(resent.json().invitationSent, true);
  assert.deepEqual(calls, [['resend', 'analyst@example.com'], ['audit', 'analyst@example.com']]);
  const active = await app.inject({ method: 'POST', url: '/api/members/active-sub/resend-invitation', headers });
  assert.equal(active.statusCode, 409);
});

test('platform admin support session assumes target visibility but remains read-only and audited', async (t) => {
  const audits = [];
  const adminRepository = {
    ...repository,
    async resolveContext({ tenantSlug, identity }) {
      const context = await repository.resolveContext({ tenantSlug, identity });
      return { ...context, principal: { ...context.principal, role: 'platform_admin', isPlatformAdmin: true } };
    },
    async listMembers() {
      return [
        { identitySubject: 'user-1', email: 'owner@example.com', role: 'owner', status: 'active' },
        { identitySubject: 'analyst-1', email: 'analyst@example.com', role: 'analyst', status: 'active' }
      ];
    },
    async auditImpersonation(_context, action, target, metadata) { audits.push({ action, target, metadata }); }
  };
  const app = await createApp({ authenticator, repository: adminRepository, registry, impersonationService: new ImpersonationService('01234567890123456789012345678901') });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  const started = await app.inject({ method: 'POST', url: '/api/support/impersonation', headers, payload: { targetSubject: 'analyst-1', reason: 'Investigating dashboard visibility issue', durationMinutes: 15 } });
  assert.equal(started.statusCode, 201);
  const supportHeaders = { ...headers, 'x-support-session': started.json().token };
  const context = await app.inject({ method: 'GET', url: '/api/context', headers: supportHeaders });
  assert.equal(context.json().user.role, 'analyst');
  assert.equal(context.json().impersonation.active, true);
  const blocked = await app.inject({ method: 'PUT', url: '/api/features/dashboard', headers: supportHeaders, payload: { enabled: false } });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error, 'support impersonation is read-only');
  const ended = await app.inject({ method: 'POST', url: '/api/support/impersonation/end', headers: supportHeaders, payload: {} });
  assert.equal(ended.statusCode, 200);
  assert.deepEqual(audits.map((item) => item.action), ['impersonation.start', 'impersonation.end']);
});

test('platform admin provisions tenants and secret-free connection metadata through bounded routes', async (t) => {
  const calls = [];
  const tenant = { id: 'tenant-2', slug: 'new-dsp', displayName: 'New DSP', status: 'active', createdAt: '2026-09-22T00:00:00Z' };
  const adminRepository = {
    ...repository,
    async resolveContext({ tenantSlug, identity }) {
      const context = await repository.resolveContext({ tenantSlug, identity });
      return { ...context, principal: { ...context.principal, role: 'platform_admin', isPlatformAdmin: true } };
    },
    async listAllTenants() { return [tenant]; },
    async getTenantBySlug(slug) { return slug === tenant.slug ? tenant : null; },
    async provisionTenant(value) {
      calls.push(['provision', value]);
      return { tenant: { ...tenant, slug: value.slug, displayName: value.displayName }, owner: { email: value.ownerEmail, identitySubject: value.ownerIdentitySubject, role: 'owner', status: 'invited' } };
    },
    async listTenantFeatures() { return []; },
    async listTenantConnections() { return []; },
    async listTenantMembers() { return [{ identitySubject: 'tenant-owner', email: 'owner@new.example', role: 'owner', status: 'active' }]; },
    async listAllMembers() { return { members: [], total: 0 }; },
    async auditPlatformEvent(...value) { calls.push(['audit', value]); }
  };
  const memberProvisioner = {
    async invite(value) { calls.push(['identity', value]); return { identitySubject: 'cognito-owner', invitationSent: true }; }
  };
  const app = await createApp({
    authenticator, repository: adminRepository, registry, memberProvisioner,
    impersonationService: new ImpersonationService('01234567890123456789012345678901')
  });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  const listed = await app.inject({ method: 'GET', url: '/api/super-admin/tenants', headers });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().tenants[0].slug, 'new-dsp');
  const created = await app.inject({
    method: 'POST', url: '/api/super-admin/tenants', headers,
    payload: { slug: 'second-dsp', displayName: 'Second DSP', ownerEmail: 'owner@second.example', ownerGivenName: 'New', ownerFamilyName: 'Owner', moduleIds: ['executive_dashboard'] }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().owner.invitationSent, true);
  assert.deepEqual(calls.slice(0, 2).map(([kind]) => kind), ['identity', 'provision']);
  assert.equal(calls[1][1].ownerIdentitySubject, 'cognito-owner');
  const secretRejected = await app.inject({
    method: 'POST', url: '/api/super-admin/tenants/new-dsp/connections', headers,
    payload: { integrationType: 'digits_api', displayName: 'Digits', authKind: 'api_credentials', config: { apiToken: 'must-not-pass' } }
  });
  assert.equal(secretRejected.statusCode, 400);
  assert.match(secretRejected.json().error, /tenant vault/);
  const support = await app.inject({
    method: 'POST', url: '/api/super-admin/impersonate', headers,
    payload: { tenantSlug: 'new-dsp', targetSubject: 'tenant-owner', reason: 'Reviewing tenant onboarding configuration' }
  });
  assert.equal(support.statusCode, 201);
  assert.equal(support.json().target.tenantSlug, 'new-dsp');
  assert.ok(support.json().token.split('.').length === 3);
});

test('super-admin migration keeps platform audit append-only without redefining admin identities', async () => {
  const migration = await fs.readFile(
    new URL('../db/migrations/010_super_admin_tenant_management.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /create table if not exists app\.platform_audit_events/i);
  assert.match(migration, /create trigger platform_audit_events_append_only/i);
  assert.match(migration, /app\.prevent_platform_audit_mutation/i);
  assert.doesNotMatch(migration, /create table if not exists app\.platform_admins/i);
  assert.doesNotMatch(migration, /drop table/i);
});

test('dispute filing requires owner confirmation and delegates to the guarded adapter', async (t) => {
  const calls = [];
  const disputeSubmission = {
    async submit(value) {
      calls.push(value);
      return { status: 'submitted', confirmation: 'AMZ-123', alreadySubmitted: false };
    }
  };
  const app = await createApp({ authenticator, repository, disputeSubmission, registry });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' };
  const missingConfirmation = await app.inject({
    method: 'POST', url: '/api/disputes/2026-W36/dcr-jalen-douglas/submit', headers, payload: {}
  });
  assert.equal(missingConfirmation.statusCode, 400);
  assert.equal(missingConfirmation.json().error, 'explicit confirmation is required');
  const submitted = await app.inject({
    method: 'POST', url: '/api/disputes/2026-W36/dcr-jalen-douglas/submit', headers, payload: { confirmation: true }
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.json().confirmation, 'AMZ-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].week, '2026-W36');
  assert.equal(calls[0].submissionKey, 'dcr-jalen-douglas');
});

test('dispute filing is unavailable without a real Amazon submission adapter', async (t) => {
  const app = await createApp({ authenticator, repository, registry });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/disputes/2026-W36/dcr-jalen-douglas/submit',
    headers: { authorization: 'Bearer test', 'x-tenant-id': 'jec-logistics', 'content-type': 'application/json' },
    payload: { confirmation: true }
  });
  assert.equal(response.statusCode, 503);
  assert.match(response.json().error, /adapter is unavailable/);
});
