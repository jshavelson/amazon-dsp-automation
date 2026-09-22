begin;

create table if not exists app.platform_admins (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists app.tenant_feature_overrides (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  feature_id text not null check (feature_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  enabled boolean not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_id)
);

create unique index if not exists tenant_memberships_email_unique
  on app.tenant_memberships (tenant_id, lower(email)) where email is not null;

insert into app.platform_admins(email) values ('jason@jeclogs.com') on conflict do nothing;

alter table app.tenant_feature_overrides enable row level security;
create policy tenant_feature_overrides_isolation on app.tenant_feature_overrides
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

drop policy if exists tenant_memberships_isolation on app.tenant_memberships;
create policy tenant_memberships_isolation on app.tenant_memberships
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());

grant select on app.platform_admins to dsp_app_runtime;
grant select, insert, update on app.tenant_feature_overrides to dsp_app_runtime;
grant select, insert, update on app.tenant_memberships to dsp_app_runtime;

commit;
