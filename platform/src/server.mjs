import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { OidcAuthenticator } from './oidc-authenticator.mjs';
import { PostgresRepository } from './postgres-repository.mjs';

const config = loadConfig();
const repository = new PostgresRepository({ connectionString: config.DATABASE_URL });
const authenticator = new OidcAuthenticator({
  issuer: config.OIDC_ISSUER,
  audience: config.OIDC_AUDIENCE,
  jwksUrl: config.OIDC_JWKS_URL
});
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
  dashboardHtmlPath: config.DASHBOARD_HTML_PATH
});

const shutdown = async () => {
  await app.close();
  await repository.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
