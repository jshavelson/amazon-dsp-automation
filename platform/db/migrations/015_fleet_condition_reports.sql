begin;

create table if not exists app.fleet_condition_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  artifact_id uuid references app.connector_artifacts(id) on delete set null,
  captured_at timestamptz not null,
  previous_quarter_fca_percent numeric(5,2),
  previous_quarter_wear_tear_percent numeric(5,2),
  current_quarter_fca_percent numeric(5,2) not null,
  current_quarter_wear_tear_percent numeric(5,2) not null,
  eligible_vehicle_count integer,
  compliant_vehicle_count integer,
  wear_tear_passing_count integer,
  unique (tenant_id, artifact_id)
);

create table if not exists app.fleet_condition_vehicles (
  report_id uuid not null references app.fleet_condition_reports(id) on delete cascade,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  vin text not null,
  make text,
  model text,
  year integer,
  due_date date,
  last_pave_at date,
  wear_tear_grade integer check (wear_tear_grade between 0 and 5),
  fca_status text not null,
  primary key (report_id, vin)
);

alter table app.fleet_condition_reports enable row level security;
alter table app.fleet_condition_vehicles enable row level security;
create policy fleet_condition_reports_isolation on app.fleet_condition_reports using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
create policy fleet_condition_vehicles_isolation on app.fleet_condition_vehicles using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
grant select on app.fleet_condition_reports, app.fleet_condition_vehicles to dsp_app_runtime;
grant select, insert, update on app.fleet_condition_reports, app.fleet_condition_vehicles to dsp_worker;

commit;
