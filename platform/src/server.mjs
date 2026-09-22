import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { OidcAuthenticator } from './oidc-authenticator.mjs';
import { PostgresRepository } from './postgres-repository.mjs';
import { createAwsSecretsManagerProvider } from './secrets/aws-secrets-manager-provider.mjs';
import { ConnectionService } from './integrations/connection-service.mjs';
import { AssistantService } from './assistant-service.mjs';

const config = loadConfig();
const repository = new PostgresRepository({ connectionString: config.DATABASE_URL });
const authenticator = new OidcAuthenticator({
  issuer: config.OIDC_ISSUER,
  audience: config.OIDC_AUDIENCE,
  jwksUrl: config.OIDC_JWKS_URL
});
const secretProvider = createAwsSecretsManagerProvider({
  region: process.env.AWS_REGION || 'us-east-2',
  prefix: config.SECRET_PREFIX,
  audit: async (event) => {
    app?.log?.info({
      action: event.action,
      tenantId: event.tenantId,
      integration: event.integration,
      secretName: event.secretName,
      purpose: event.purpose
    }, 'connector secret access');
  }
});
const connectionService = new ConnectionService({ repository, secretProvider });
const assistantService = new AssistantService({ repository });
const app = await createApp({
  authenticator,
  repository,
  logger: true,
  authConfig: {
    clientId: config.AUTH_CLIENT_ID,
    authorizationUrl: config.AUTHORIZATION_URL,
    tokenUrl: config.TOKEN_URL,
    tenantSlug: config.TENANT_SLUG
  },
  dashboardHtmlPath: config.DASHBOARD_HTML_PATH,
  connectionService,
  assistantService,
  exposeLegacyDashboard: true
});

const shutdown = async () => {
  await app.close();
  await repository.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
