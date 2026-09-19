begin;

create extension if not exists pgcrypto;
create schema if not exists app;

create table if not exists app.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{2,62}$'),
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists app.tenant_memberships (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  identity_subject text not null,
  email text,
  role text not null check (role in ('owner', 'admin', 'reviewer', 'analyst', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, identity_subject)
);

create table if not exists app.module_catalog (
  module_id text primary key check (module_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  billing_sku text not null unique,
  display_name text not null,
  manifest_version integer not null check (manifest_version > 0),
  created_at timestamptz not null default now()
);

create table if not exists app.tenant_entitlements (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  module_id text not null references app.module_catalog(module_id),
  status text not null check (status in ('trial', 'active', 'suspended', 'cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  billing_reference text,
  primary key (tenant_id, module_id)
);

create table if not exists app.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  integration_type text not null,
  display_name text not null,
  secret_reference text not null check (secret_reference like 'secret://%'),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'healthy', 'degraded', 'disabled')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, integration_type, display_name),
  check (not (config ?| array['password','api_key','apiKey','token','refresh_token','refreshToken','private_key','privateKey']))
);

create table if not exists app.workflow_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  module_id text not null references app.module_catalog(module_id),
  external_key text not null,
  status text not null check (status in ('draft', 'needs_evidence', 'awaiting_approval', 'approved', 'declined', 'submitting', 'submitted', 'submission_unknown', 'closed')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  estimated_value_cents bigint,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, module_id, external_key)
);

create table if not exists app.approval_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  case_id uuid not null references app.workflow_cases(id) on delete cascade,
  actor_subject text not null,
  decision text not null check (decision in ('approved', 'declined')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  source_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists app.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  actor_subject text not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  request_id uuid not null,
  source_ip inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_tenant_id', true), '')::uuid
$$;

create or replace function app.current_identity_subject() returns text
language sql stable as $$
  select nullif(current_setting('app.current_identity_subject', true), '')
$$;

alter table app.tenant_memberships enable row level security;
alter table app.tenant_entitlements enable row level security;
alter table app.integration_connections enable row level security;
alter table app.workflow_cases enable row level security;
alter table app.approval_events enable row level security;
alter table app.audit_events enable row level security;

create policy tenant_memberships_isolation on app.tenant_memberships
  using (tenant_id = app.current_tenant_id() and identity_subject = app.current_identity_subject())
  with check (tenant_id = app.current_tenant_id());
create policy tenant_entitlements_isolation on app.tenant_entitlements
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy integration_connections_isolation on app.integration_connections
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy workflow_cases_isolation on app.workflow_cases
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy approval_events_isolation on app.approval_events
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy audit_events_isolation on app.audit_events
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

create or replace function app.prevent_audit_mutation() returns trigger
language plpgsql as $$ begin raise exception 'audit events are append-only'; end $$;
create trigger audit_events_append_only
before update or delete on app.audit_events
for each row execute function app.prevent_audit_mutation();

commit;
