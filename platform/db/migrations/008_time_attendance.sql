begin;

create table if not exists app.attendance_day_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  provider text not null default 'adp',
  employee_external_id text not null,
  employee_name text not null,
  work_date date not null,
  duration_hours numeric(7,2) not null check (duration_hours >= 0),
  source_period text,
  source_record_id text,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, employee_external_id, work_date, source_record_id)
);

create table if not exists app.daily_route_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  employee_external_id text not null,
  employee_name text,
  route_code text not null,
  route_date date not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, employee_external_id, route_code, route_date)
);

create index if not exists attendance_day_entries_tenant_date
  on app.attendance_day_entries (tenant_id, work_date desc);
create index if not exists daily_route_assignments_tenant_date
  on app.daily_route_assignments (tenant_id, route_date desc);

alter table app.attendance_day_entries enable row level security;
alter table app.daily_route_assignments enable row level security;
create policy attendance_day_entries_isolation on app.attendance_day_entries
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
create policy daily_route_assignments_isolation on app.daily_route_assignments
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

grant select on app.attendance_day_entries, app.daily_route_assignments to dsp_app_runtime;
grant select, insert, update, delete on app.attendance_day_entries, app.daily_route_assignments to dsp_worker;

commit;
