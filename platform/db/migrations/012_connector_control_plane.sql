begin;

create table if not exists app.connector_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  integration_type text not null,
  purpose text not null check (purpose in ('connect', 'reauthenticate')),
  status text not null default 'queued'
    check (status in ('queued', 'starting', 'waiting_for_user', 'verifying', 'completed', 'failed', 'expired')),
  launch_url text,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  error_code text,
  error_message text,
  check (expires_at > created_at)
);

create unique index if not exists connector_sessions_one_active
  on app.connector_sessions (tenant_id, integration_type)
  where status in ('queued', 'starting', 'waiting_for_user', 'verifying');

create table if not exists app.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  integration_type text not null,
  session_id uuid references app.connector_sessions(id) on delete set null,
  job_type text not null check (job_type in ('connect', 'sync', 'health_check')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  result jsonb not null default '{}'::jsonb,
  last_error text,
  unique (tenant_id, idempotency_key)
);

create index if not exists connector_jobs_tenant_status
  on app.connector_jobs (tenant_id, integration_type, status, requested_at desc);

create table if not exists app.connector_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  integration_type text not null,
  job_id uuid not null references app.connector_jobs(id) on delete cascade,
  feed text not null,
  reporting_period text,
  storage_key text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  ingested_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, integration_type, content_sha256)
);

alter table app.connector_sessions enable row level security;
alter table app.connector_jobs enable row level security;
alter table app.connector_artifacts enable row level security;

create policy connector_sessions_isolation on app.connector_sessions
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy connector_jobs_isolation on app.connector_jobs
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy connector_artifacts_isolation on app.connector_artifacts
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

grant select, insert, update on app.connector_sessions, app.connector_jobs to dsp_app_runtime;
grant select, insert, update on app.connector_sessions, app.connector_jobs, app.connector_artifacts to dsp_worker;
grant select on app.tenants, app.platform_admins, app.tenant_memberships, app.tenant_entitlements to dsp_worker;

commit;
