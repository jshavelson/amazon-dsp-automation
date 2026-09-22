import { requirePermission } from '../authorization.mjs';

export function impersonationRoutes(app, { repository, impersonationService }) {
  app.post('/api/support/impersonation', async (request, reply) => {
    const principal = request.tenantContext.principal;
    requirePermission(principal, 'impersonation.manage');
    const targetSubject = String(request.body?.targetSubject || '');
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return reply.code(400).send({ error: 'troubleshooting reason must be 10 to 500 characters' });
    const members = await repository.listMembers(request.tenantContext);
    const target = members.find((member) => member.identitySubject === targetSubject && member.status === 'active');
    if (!target) return reply.code(404).send({ error: 'active target user not found' });
    if (target.identitySubject === principal.userId) return reply.code(400).send({ error: 'cannot impersonate yourself' });
    const session = await impersonationService.create({ actor: principal, tenantId: principal.tenantId, target, reason, durationMinutes: request.body?.durationMinutes });
    await repository.auditImpersonation(request.tenantContext, 'impersonation.start', target, { reason, expiresInSeconds: session.expiresInSeconds });
    return reply.code(201).send({ ...session, target: { email: target.email, role: target.role } });
  });

  app.post('/api/support/impersonation/end', async (request) => {
    const principal = request.tenantContext.principal;
    const actor = principal.impersonation?.actor || principal;
    requirePermission(actor, 'impersonation.manage');
    if (principal.impersonation) await repository.auditImpersonation(request.tenantContext, 'impersonation.end', {
      identitySubject: principal.userId, email: principal.email, role: principal.role
    }, {});
    return { ended: true };
  });
}
