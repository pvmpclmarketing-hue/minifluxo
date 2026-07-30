create extension if not exists pgcrypto;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('meta', 'uazapi')),
  name text not null,
  instance_name text,
  site_integration_key uuid not null default gen_random_uuid() unique,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

alter table public.connections add column if not exists site_integration_key uuid not null default gen_random_uuid();
alter table public.connections add column if not exists uazapi_token_cipher text;
alter table public.connections add column if not exists uazapi_token_hash text;
create unique index if not exists connections_site_integration_key_idx on public.connections(site_integration_key);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  source text not null check (source in ('site', 'manual', 'payment')),
  music_request text,
  status text not null default 'waiting_pix',
  provider text,
  connection_id uuid references public.connections(id) on delete set null,
  external_order_id text,
  order_context jsonb not null default '{}'::jsonb,
  kie_task_id text,
  music_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists connection_id uuid references public.connections(id) on delete set null;
alter table public.leads add column if not exists external_order_id text;
alter table public.leads add column if not exists order_context jsonb not null default '{}'::jsonb;
-- Uma geração Kie e um pedido externo só podem pertencer a uma execução da conta.
create unique index if not exists leads_kie_task_id_unique_idx on public.leads(kie_task_id) where kie_task_id is not null;
create unique index if not exists leads_owner_external_order_unique_idx on public.leads(owner_id, external_order_id) where external_order_id is not null;

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused')),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connection_flow_configs (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payment_flow_id uuid references public.flows(id) on delete set null,
  site_flow_id uuid references public.flows(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.connection_flow_configs add column if not exists conversation_flow_id uuid references public.flows(id) on delete set null;

-- Chave estavel por conta. O usuario pode trocar de WhatsApp sem alterar o site.
create table if not exists public.site_integrations (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  integration_key uuid not null default gen_random_uuid() unique,
  connection_id uuid references public.connections(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- As chaves ficam criptografadas pela aplicacao antes de chegar nesta tabela.
-- Nunca grave chaves de API dentro de flows.nodes (o canvas e lido pelo navegador).
create table if not exists public.flow_credentials (
  flow_id uuid primary key references public.flows(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  gpt_key_cipher text,
  kie_key_cipher text,
  updated_at timestamptz not null default now()
);

-- Credenciais da conta: usadas por todos os fluxos do mesmo usuário.
-- Os valores chegam aqui já criptografados pelo backend.
create table if not exists public.account_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  gpt_key_cipher text,
  kie_key_cipher text,
  updated_at timestamptz not null default now()
);

alter table public.connections enable row level security;
alter table public.leads enable row level security;
alter table public.flows enable row level security;
alter table public.connection_flow_configs enable row level security;
alter table public.flow_credentials enable row level security;
alter table public.account_credentials enable row level security;
alter table public.site_integrations enable row level security;
drop policy if exists "users access own connections" on public.connections;
drop policy if exists "users access own leads" on public.leads;
drop policy if exists "users access own flows" on public.flows;
drop policy if exists "users access own connection flow configs" on public.connection_flow_configs;
drop policy if exists "users access own flow credentials" on public.flow_credentials;
drop policy if exists "users access own account credentials" on public.account_credentials;
drop policy if exists "users access own site integration" on public.site_integrations;
create policy "users access own connections" on public.connections for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own leads" on public.leads for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own flows" on public.flows for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own connection flow configs" on public.connection_flow_configs for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own flow credentials" on public.flow_credentials for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own account credentials" on public.account_credentials for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own site integration" on public.site_integrations for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
