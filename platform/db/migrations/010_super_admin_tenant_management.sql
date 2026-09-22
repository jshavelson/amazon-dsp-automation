begin;

alter table app.tenants
  add column if not exists updated_at timestamptz not null default now();

create table if not exists app.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_subject text not null,
  actor_email text,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  request_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_actor_idx
  on app.platform_audit_events (actor_subject, created_at desc);
create index if not exists platform_audit_events_resource_idx
  on app.platform_audit_events (resource_type, resource_id, created_at desc);

create or replace function app.prevent_platform_audit_mutation() returns trigger
language plpgsql as $$ begin raise exception 'platform audit events are append-only'; end $$;
drop trigger if exists platform_audit_events_append_only on app.platform_audit_events;
create trigger platform_audit_events_append_only
before update or delete on app.platform_audit_events
for each row execute function app.prevent_platform_audit_mutation();

grant select, insert on app.platform_audit_events to dsp_app_runtime;
grant insert, update on app.tenants to dsp_app_runtime;
grant insert on app.tenant_memberships, app.tenant_entitlements, app.integration_connections to dsp_app_runtime;
grant usage, select on sequence app.platform_audit_events_id_seq to dsp_app_runtime;

commit;
