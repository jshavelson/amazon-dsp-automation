begin;

alter table app.dispatch_route_assignments add column if not exists route_code text;
alter table app.dispatch_route_assignments add column if not exists pad text;
alter table app.dispatch_route_assignments add column if not exists staging_area text;
update app.dispatch_route_assignments set route_code = route_id where route_code is null;
alter table app.dispatch_route_assignments alter column route_code set not null;
alter table app.dispatch_route_assignments drop constraint if exists dispatch_route_assignments_pkey;
alter table app.dispatch_route_assignments
  add primary key (tenant_id, delivery_date, route_code);

create table if not exists app.dispatch_day_plans (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  delivery_date date not null,
  expected_routes integer not null default 0 check (expected_routes between 0 and 250),
  sweepers integer not null default 0 check (sweepers between 0 and 100),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, delivery_date)
);

alter table app.dispatch_day_plans enable row level security;
create policy dispatch_day_plans_isolation on app.dispatch_day_plans
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
grant select, insert, update, delete on app.dispatch_day_plans to dsp_app_runtime;
grant select, insert, update, delete on app.dispatch_day_plans to dsp_worker;

commit;
