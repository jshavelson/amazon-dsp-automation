begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dsp_app_runtime') then create role dsp_app_runtime nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'dsp_worker') then create role dsp_worker nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'dsp_billing') then create role dsp_billing nologin; end if;
end $$;

revoke all on schema app from public;
revoke all on all tables in schema app from public;
revoke all on all sequences in schema app from public;
revoke all on all functions in schema app from public;

grant usage on schema app to dsp_app_runtime, dsp_worker, dsp_billing;
grant execute on function app.current_tenant_id() to dsp_app_runtime, dsp_worker, dsp_billing;
grant execute on function app.current_identity_subject() to dsp_app_runtime, dsp_worker, dsp_billing;

grant select on app.tenants, app.tenant_memberships, app.module_catalog,
  app.tenant_entitlements, app.integration_connections, app.workflow_cases,
  app.dashboard_snapshots, app.integration_sync_runs, app.workflow_runs
  to dsp_app_runtime;

grant select on all tables in schema app to dsp_worker;
grant insert, update on app.workflow_runs, app.workflow_cases, app.integration_connections,
  app.dashboard_snapshots, app.integration_sync_runs to dsp_worker;
grant insert on app.approval_events, app.audit_events to dsp_worker;
grant usage, select on all sequences in schema app to dsp_worker;

grant select on app.tenants, app.module_catalog, app.tenant_entitlements to dsp_billing;
grant insert, update on app.tenant_entitlements to dsp_billing;

commit;
