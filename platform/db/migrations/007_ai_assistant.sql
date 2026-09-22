begin;

create table if not exists app.ai_conversations (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_subject text not null,
  current_path text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists app.ai_messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  conversation_id uuid not null references app.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists app.ai_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  conversation_id uuid not null references app.ai_conversations(id) on delete cascade,
  provider_request_id text,
  model text not null,
  input_tokens bigint,
  output_tokens bigint,
  latency_ms integer,
  created_at timestamptz not null default now()
);

alter table app.ai_conversations enable row level security;
alter table app.ai_messages enable row level security;
alter table app.ai_usage_events enable row level security;
create policy ai_conversations_isolation on app.ai_conversations using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
create policy ai_messages_isolation on app.ai_messages using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());
create policy ai_usage_events_isolation on app.ai_usage_events using (tenant_id=app.current_tenant_id()) with check (tenant_id=app.current_tenant_id());

grant select, insert on app.ai_conversations, app.ai_messages, app.ai_usage_events to dsp_app_runtime;
grant usage, select on all sequences in schema app to dsp_app_runtime;

commit;
