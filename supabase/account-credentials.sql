-- Execute uma única vez no SQL Editor do Supabase do WhatsEntregavel.
create table if not exists public.account_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  gpt_key_cipher text,
  kie_key_cipher text,
  updated_at timestamptz not null default now()
);

alter table public.account_credentials enable row level security;
drop policy if exists "users access own account credentials" on public.account_credentials;
create policy "users access own account credentials"
on public.account_credentials for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);
