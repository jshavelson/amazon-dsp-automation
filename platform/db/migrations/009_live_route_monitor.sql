begin;
create table if not exists app.live_routes (
  tenant_id uuid not null references app.tenants(id) on delete cascade, route_id text not null,
  transporter_id text not null default '', route_code text not null, delivery_date date not null,
  driver_name text not null default '', vin text not null default '',
  status text not null check (status in ('assigned', 'in_progress', 'completed')),
  risk text not null check (risk in ('on_track', 'late_departure', 'behind', 'stalled')),
  planned_departure_at timestamptz, actual_departure_at timestamptz, projected_completion_at timestamptz,
  scheduled_end_at timestamptz, last_event_at timestamptz, total_stops integer not null default 0,
  completed_stops integer not null default 0, total_packages integer not null default 0,
  delivered_packages integer not null default 0, stops_last_hour integer not null default 0,
  late_departure_minutes integer not null default 0, projected_late_minutes integer not null default 0,
  inactive_minutes integer not null default 0, on_break boolean not null default false,
  route_paused boolean not null default false, rescue_count integer not null default 0,
  associated_routes jsonb not null default '[]'::jsonb, is_multi_route boolean not null default false,
  captured_at timestamptz not null, source_fingerprint text not null,
  primary key (tenant_id, route_id, transporter_id, delivery_date)
);
create index if not exists live_routes_tenant_date on app.live_routes (tenant_id, delivery_date desc, captured_at desc);
alter table app.live_routes enable row level security;
create policy live_routes_isolation on app.live_routes
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
grant select on app.live_routes to dsp_app_runtime;
grant select, insert, update, delete on app.live_routes to dsp_worker;
commit;
