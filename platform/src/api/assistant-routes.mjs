export function assistantRoutes(app, { assistantService }) {
  app.get('/api/assistant/status', async (request) => assistantService?.status(request.tenantContext) || { configured: false, readOnly: true, voiceMode: 'browser' });
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
