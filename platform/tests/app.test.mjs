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
  const invited = await app.inject({ method: 'POST', url: '/api/members/invitations', headers, payload: { email: 'analyst@example.com', role: 'analyst' } });
  assert.equal(invited.statusCode, 201);
  assert.equal(invited.json().member.status, 'invited');
  const featureUpdate = await app.inject({ method: 'PUT', url: '/api/features/dashboard', headers, payload: { enabled: false } });
  assert.equal(featureUpdate.statusCode, 403);
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
