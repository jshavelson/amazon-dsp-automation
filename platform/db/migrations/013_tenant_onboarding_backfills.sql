begin;

create table if not exists app.tenant_onboarding_backfills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  feed_group text not null,
  source_options jsonb not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'waiting_for_connection'
    check (status in ('waiting_for_connection','queued','running','completed','partial','failed')),
  required boolean not null default true,
  completed_sources jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, feed_group),
  check (period_end >= period_start),
  check (jsonb_typeof(source_options) = 'array')
);

create index if not exists tenant_onboarding_backfills_status
  on app.tenant_onboarding_backfills (tenant_id, status, feed_group);

alter table app.tenant_onboarding_backfills enable row level security;
create policy tenant_onboarding_backfills_isolation on app.tenant_onboarding_backfills
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

grant select, insert, update on app.tenant_onboarding_backfills to dsp_app_runtime;
grant select, insert, update on app.tenant_onboarding_backfills to dsp_worker;

commit;
