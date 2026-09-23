import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(HERE, '..');
const MIGRATION_PROBES = new Map([
  ['001_multi_tenant_foundation.sql', "select to_regclass('app.audit_events') is not null as applied"],
  ['002_dashboard_and_runs.sql', "select to_regclass('app.integration_sync_runs') is not null as applied"],
  ['003_least_privilege_roles.sql', "select exists (select 1 from pg_roles where rolname = 'dsp_app_runtime') as applied"]
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const client = new Client({
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'dsp_platform',
  user: required('DB_ADMIN_USER'),
  password: required('DB_ADMIN_PASSWORD'),
  ssl: { rejectUnauthorized: true }
});

async function applyMigrations() {
  const migrationDirectory = path.join(PLATFORM, 'db', 'migrations');
  const migrations = (await fs.readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  await client.query(`create table if not exists public.platform_schema_migrations (
    migration_name text primary key,
    applied_at timestamptz not null default now()
  )`);
  for (const migration of migrations) {
    const recorded = await client.query(
      'select 1 from public.platform_schema_migrations where migration_name = $1',
      [migration]
    );
    if (recorded.rowCount) {
      console.log(`skipped ${migration}`);
      continue;
    }
    const probe = MIGRATION_PROBES.get(migration);
    if (probe && (await client.query(probe)).rows[0]?.applied) {
      await client.query(
        'insert into public.platform_schema_migrations (migration_name) values ($1) on conflict do nothing',
        [migration]
      );
      console.log(`baselined ${migration}`);
      continue;
    }
    await client.query(await fs.readFile(path.join(migrationDirectory, migration), 'utf8'));
    await client.query(
      'insert into public.platform_schema_migrations (migration_name) values ($1)',
      [migration]
    );
    console.log(`applied ${migration}`);
  }
}

async function configureRuntimeRole() {
  const password = required('DB_RUNTIME_PASSWORD');
  await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'dsp_app_login') then create role dsp_app_login login; end if; end $$");
  const statement = await client.query("select format('alter role dsp_app_login password %L', $1::text) as sql", [password]);
  await client.query(statement.rows[0].sql);
  await client.query('grant dsp_app_runtime to dsp_app_login');
  const workerPassword = required('DB_WORKER_PASSWORD');
  await client.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'dsp_worker_login') then create role dsp_worker_login login; end if; end $$");
  const workerStatement = await client.query("select format('alter role dsp_worker_login password %L', $1::text) as sql", [workerPassword]);
  await client.query(workerStatement.rows[0].sql);
  await client.query('grant dsp_worker to dsp_worker_login');
}

async function seedTenant() {
  const ownerSubject = required('OWNER_SUBJECT');
  const ownerEmail = required('OWNER_EMAIL');
  await client.query(
    `insert into app.platform_admins (email, active) values (lower($1), true)
     on conflict (email) do update set active = true`,
    [ownerEmail]
  );
  const tenantSlug = process.env.TENANT_SLUG || 'jecs';
  const tenantName = process.env.TENANT_NAME || 'JEC Logistics Solutions';
  const tenant = await client.query(
    `insert into app.tenants (slug, display_name, status) values ($1, $2, 'active')
     on conflict (slug) do update set display_name = excluded.display_name, status = 'active'
     returning id`,
    [tenantSlug, tenantName]
  );
  const tenantId = tenant.rows[0].id;
  const moduleDirectories = await fs.readdir(path.join(PLATFORM, 'modules'));
  for (const directory of moduleDirectories.sort()) {
    const manifestPath = path.join(PLATFORM, 'modules', directory, 'module.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await client.query(
      `insert into app.module_catalog (module_id, billing_sku, display_name, manifest_version)
       values ($1, $2, $3, $4)
       on conflict (module_id) do update set billing_sku = excluded.billing_sku, display_name = excluded.display_name, manifest_version = excluded.manifest_version`,
      [manifest.id, manifest.billingSku, manifest.displayName, manifest.version]
    );
    await client.query(
      `insert into app.tenant_entitlements (tenant_id, module_id, status)
       values ($1, $2, 'active')
       on conflict (tenant_id, module_id) do update set status = 'active', ends_at = null`,
      [tenantId, manifest.id]
    );
  }
  await client.query(
    `insert into app.tenant_memberships (tenant_id, identity_subject, email, role, status)
     values ($1, $2, $3, 'owner', 'active')
     on conflict (tenant_id, identity_subject) do update set email = excluded.email, role = 'owner', status = 'active'`,
    [tenantId, ownerSubject, ownerEmail]
  );
}

try {
  await client.connect();
  await applyMigrations();
  await configureRuntimeRole();
  await seedTenant();
  console.log('database bootstrap completed');
} finally {
  await client.end();
}
