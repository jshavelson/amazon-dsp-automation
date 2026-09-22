import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).default('dsp_platform'),
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().min(1).optional(),
  OIDC_ISSUER: z.url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URL: z.url(),
  AUTH_CLIENT_ID: z.string().min(1),
  AUTHORIZATION_URL: z.url(),
  TOKEN_URL: z.url(),
  TENANT_SLUG: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  DASHBOARD_HTML_PATH: z.string().min(1).default('/app/dashboard/amazon-dsp-kpi-dashboard.html'),
  SECRET_PREFIX: z.string().min(1).default('dsp/credentials')
});

export function loadConfig(environment = process.env) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`invalid platform configuration: ${fields}`);
  }
  const data = parsed.data;
  const databaseUrl = data.DATABASE_URL || (
    data.DB_HOST && data.DB_USER && data.DB_PASSWORD
      ? `postgresql://${encodeURIComponent(data.DB_USER)}:${encodeURIComponent(data.DB_PASSWORD)}@${data.DB_HOST}:${data.DB_PORT}/${encodeURIComponent(data.DB_NAME)}?sslmode=require`
      : null
  );
  if (!databaseUrl) throw new Error('invalid platform configuration: DATABASE_URL or DB_HOST, DB_USER, and DB_PASSWORD');
  return Object.freeze({ ...data, DATABASE_URL: databaseUrl });
}
