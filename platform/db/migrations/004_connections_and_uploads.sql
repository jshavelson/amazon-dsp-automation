begin;

-- Connection lifecycle: re-authentication is a first-class state so a revoked
-- Amazon session surfaces in the product instead of failing a scheduled job.
alter table app.integration_connections
  drop constraint if exists integration_connections_status_check;
alter table app.integration_connections
  add constraint integration_connections_status_check
  check (status in ('pending', 'healthy', 'degraded', 'needs_reauth', 'disabled'));

alter table app.integration_connections
  add column if not exists auth_kind text not null default 'api_credentials'
    check (auth_kind in ('api_credentials', 'browser_session', 'imap_password', 'manual_upload')),
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text,
  add column if not exists reauth_required_at timestamptz,
  add column if not exists session_expires_at timestamptz,
  add column if not exists schedule text,
  add column if not exists created_by text;

-- Tenant-uploaded source files (Digits first). Bytes live in S3 under
-- tenants/{tenant}/{source}/; only metadata and the content hash live here.
create table if not exists app.tenant_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{2,63}$'),
  period_key text,
  original_filename text not null,
  storage_key text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'confirmed', 'superseded', 'rejected')),
  parse_summary jsonb not null default '{}'::jsonb,
  rejected_reason text,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (tenant_id, source, content_sha256)
);

create index if not exists tenant_files_lookup
  on app.tenant_files (tenant_id, source, period_key, uploaded_at desc);

-- Normalized fleet charges parsed from an uploaded Digits export.
create table if not exists app.fleet_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  file_id uuid not null references app.tenant_files(id) on delete cascade,
  period_key text not null,
  posted_on date,
  vendor text not null,
  account text,
  net_charge_cents bigint not null,
  treatment text not null check (treatment in ('INCLUDE', 'EXCLUDE')),
  memo text,
  vin text,
  invoice_number text,
  service_start date,
  service_end date,
  created_at timestamptz not null default now()
);

create index if not exists fleet_charges_period
  on app.fleet_charges (tenant_id, period_key, vendor);

alter table app.tenant_files enable row level security;
alter table app.fleet_charges enable row level security;

create policy tenant_files_isolation on app.tenant_files
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy fleet_charges_isolation on app.fleet_charges
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

grant select on app.tenant_files, app.fleet_charges to dsp_app_runtime;
grant select, insert, update on app.tenant_files, app.fleet_charges to dsp_worker;

commit;
