begin;

alter table app.integration_connections
  alter column secret_reference drop not null,
  add column if not exists last_auth_success_at timestamptz,
  add column if not exists last_data_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0
    check (consecutive_failures >= 0);

alter table app.integration_connections
  drop constraint if exists integration_connections_secret_reference_required;
alter table app.integration_connections
  add constraint integration_connections_secret_reference_required
  check (auth_kind = 'browser_session' or secret_reference like 'secret://%');

alter table app.connector_artifacts alter column job_id drop not null;

create table if not exists app.pave_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  vin text not null,
  license_plate text,
  vehicle_description text,
  assessment_status text not null,
  grade integer,
  grade_label text,
  condition_score integer,
  has_new_damage boolean not null default false,
  grounding_risk boolean not null default false,
  station text,
  external_session_key text not null,
  assessed_at timestamptz not null,
  artifact_id uuid references app.connector_artifacts(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  unique (tenant_id, external_session_key)
);

create index if not exists pave_assessments_latest_vin
  on app.pave_assessments (tenant_id, vin, assessed_at desc);
alter table app.pave_assessments enable row level security;
create policy pave_assessments_isolation on app.pave_assessments
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
grant select on app.pave_assessments to dsp_app_runtime;
grant select, insert, update on app.pave_assessments to dsp_worker;

create index if not exists integration_connections_health_due
  on app.integration_connections (integration_type, last_checked_at)
  where status <> 'disabled' and auth_kind = 'browser_session';

commit;
