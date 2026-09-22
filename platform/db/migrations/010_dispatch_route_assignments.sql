begin;

create table if not exists app.dispatch_route_assignments (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  delivery_date date not null,
  route_id text not null,
  transporter_id text not null default '',
  driver_id text,
  driver_name text,
  van_id text,
  van_label text,
  vin text,
  phone_id text,
  phone_label text,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, delivery_date, route_id, transporter_id)
);

create unique index if not exists dispatch_route_van_per_day
  on app.dispatch_route_assignments (tenant_id, delivery_date, van_id)
  where van_id is not null;
create unique index if not exists dispatch_route_phone_per_day
  on app.dispatch_route_assignments (tenant_id, delivery_date, phone_id)
  where phone_id is not null and phone_id <> '';
alter table app.dispatch_route_assignments enable row level security;
create policy dispatch_route_assignments_isolation on app.dispatch_route_assignments
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
grant select, insert, update, delete on app.dispatch_route_assignments to dsp_app_runtime;
grant select, insert, update, delete on app.dispatch_route_assignments to dsp_worker;

commit;
