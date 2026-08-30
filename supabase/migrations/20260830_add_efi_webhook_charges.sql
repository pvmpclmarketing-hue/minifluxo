create table if not exists public.efi_pix_charges (
  txid text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  node_id text not null,
  amount numeric(12,2),
  status text not null default 'pending' check (status in ('pending','paid','expired','failed')),
  payment_payload jsonb,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists efi_pix_charges_pending_idx
  on public.efi_pix_charges(status, expires_at);
create index if not exists efi_pix_charges_owner_idx
  on public.efi_pix_charges(owner_id, created_at desc);

alter table public.efi_pix_charges enable row level security;
drop policy if exists "users access own efi pix charges" on public.efi_pix_charges;
create policy "users access own efi pix charges" on public.efi_pix_charges
  for select to authenticated
  using ((select auth.uid()) = owner_id);
