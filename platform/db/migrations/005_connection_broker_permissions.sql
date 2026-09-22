begin;

grant insert, update on app.integration_connections to dsp_app_runtime;
grant insert on app.audit_events to dsp_app_runtime;
grant usage, select on all sequences in schema app to dsp_app_runtime;

commit;
