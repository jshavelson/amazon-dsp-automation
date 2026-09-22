import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { OidcAuthenticator } from './oidc-authenticator.mjs';
import { PostgresRepository } from './postgres-repository.mjs';
import { createAwsSecretsManagerProvider } from './secrets/aws-secrets-manager-provider.mjs';
import { ConnectionService } from './integrations/connection-service.mjs';
import { AssistantService } from './assistant-service.mjs';
import fs from 'node:fs/promises';
import { CognitoMemberProvisioner } from './auth/cognito-member-provisioner.mjs';

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
const connectionBaseline = await fs.readFile(new URL('../operational-snapshots/connections.json', import.meta.url), 'utf8')
  .then((value) => JSON.parse(value)).catch(() => null);
const connectionService = new ConnectionService({ repository, secretProvider, baseline: connectionBaseline });
const assistantService = new AssistantService({ repository, secretProvider });
const memberProvisioner = config.USER_POOL_ID ? new CognitoMemberProvisioner({
  userPoolId: config.USER_POOL_ID,
  region: process.env.AWS_REGION || 'us-east-2'
}) : null;
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
  memberProvisioner,
  exposeLegacyDashboard: true
});

const shutdown = async () => {
  await app.close();
  await repository.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
