create extension if not exists pgcrypto;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('meta', 'uazapi')),
  name text not null,
  instance_name text,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  source text not null check (source in ('site', 'manual')),
  music_request text,
  status text not null default 'waiting_pix',
  provider text,
  kie_task_id text,
  music_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.connections enable row level security;
alter table public.leads enable row level security;
alter table public.flows enable row level security;
drop policy if exists "users access own connections" on public.connections;
drop policy if exists "users access own leads" on public.leads;
drop policy if exists "users access own flows" on public.flows;
create policy "users access own connections" on public.connections for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own leads" on public.leads for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own flows" on public.flows for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
