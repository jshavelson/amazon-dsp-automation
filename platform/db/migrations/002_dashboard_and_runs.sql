begin;

create table if not exists app.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  module_id text not null references app.module_catalog(module_id),
  idempotency_key text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by text not null,
  input_metadata jsonb not null default '{}'::jsonb,
  output_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (tenant_id, module_id, idempotency_key),
  check (not (input_metadata ?| array['password','api_key','apiKey','token','refresh_token','refreshToken','private_key','privateKey']))
);

create table if not exists app.dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  period_key text not null,
  generated_at timestamptz not null default now(),
  metrics jsonb not null,
  source_fingerprints jsonb not null,
  stale_sources text[] not null default '{}',
  unique (tenant_id, period_key, generated_at)
);

create table if not exists app.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  source_fingerprint text,
  records_read bigint,
  records_written bigint,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table app.workflow_runs enable row level security;
alter table app.dashboard_snapshots enable row level security;
alter table app.integration_sync_runs enable row level security;

create policy workflow_runs_isolation on app.workflow_runs
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy dashboard_snapshots_isolation on app.dashboard_snapshots
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy integration_sync_runs_isolation on app.integration_sync_runs
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

commit;
