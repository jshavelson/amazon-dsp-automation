import { requirePermission } from '../authorization.mjs';

export function connectionRoutes(app, { connectionService }) {
  if (!connectionService) return;

  app.get('/api/connections', async (request) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    return connectionService.list(request.tenantContext);
  });

  app.get('/api/connections/refresh', async (request) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    return connectionService.refresh(request.tenantContext);
  });

  app.post('/api/connections/refresh', async (request) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    return connectionService.refresh(request.tenantContext);
  });

  app.put('/api/connections/:connectionId/credentials', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    try {
      const connection = await connectionService.configure(
        request.tenantContext,
        request.params.connectionId,
        request.body
      );
      return reply.code(200).send({ connection });
    } catch (error) {
      if (/unknown integration|invalid connector|credentials are required|credential field|different setup flow|does not accept credentials/.test(error.message)) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/connections/:connectionId/test', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    try {
      return await connectionService.test(request.tenantContext, request.params.connectionId);
    } catch (error) {
      if (/not configured|not available|unknown integration/.test(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      return reply.code(502).send({ error: 'provider connection test failed' });
    }
  });

  app.post('/api/connections/:connectionId/reconnect', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    try {
      return await connectionService.beginReconnect(request.tenantContext, request.params.connectionId);
    } catch (error) {
      if (/does not use browser reconnect|unavailable|unknown integration/.test(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/connections/sessions/:sessionId', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    try {
      return await connectionService.reconnectStatus(request.tenantContext, request.params.sessionId);
    } catch (error) {
      if (/not found/.test(error.message)) return reply.code(404).send({ error: error.message });
      throw error;
    }
  });

  app.post('/api/connections/:connectionId/backfill', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'integration.manage');
    try {
      return await connectionService.startBackfill(request.tenantContext, request.params.connectionId);
    } catch (error) {
      if (/unavailable|reauthentication/.test(error.message)) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}
