import { requirePermission } from '../authorization.mjs';

export function assistantRoutes(app, { assistantService }) {
  app.get('/api/assistant/status', async (request) => assistantService ? assistantService.status(request.tenantContext) : { configured: false, readOnly: true, voiceMode: 'browser' });
  app.get('/api/assistant/config', async (request) => {
    requirePermission(request.tenantContext.principal, 'ai.configure');
    return assistantService.configuration(request.tenantContext);
  });
  app.put('/api/assistant/config', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'ai.configure');
    try { return await assistantService.configure(request.tenantContext, request.body); }
    catch (error) { if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message }); throw error; }
  });
  app.post('/api/assistant/config/test', async (request, reply) => {
    requirePermission(request.tenantContext.principal, 'ai.configure');
    try { return await assistantService.testConfiguration(request.tenantContext); }
    catch (error) { if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message }); throw error; }
  });
  app.post('/api/assistant/chat', async (request, reply) => {
    if (!assistantService) return reply.code(503).send({ error: 'AI assistant is not configured' });
    try {
      return await assistantService.ask(request.tenantContext, request.body, request.id);
    } catch (error) {
      if (Number.isInteger(error.statusCode)) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
}
