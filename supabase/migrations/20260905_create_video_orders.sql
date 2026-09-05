create table if not exists public.video_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  status text not null default 'pending' check (status in ('pending','processing','rendering','uploading','complete','failed')),
  audio_url text not null,
  photos jsonb not null check (jsonb_typeof(photos) = 'array'),
  lyrics text not null,
  lyrics_timestamps jsonb,
  intro_text text,
  output_url text,
  error text,
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_orders_owner_created_idx on public.video_orders(owner_id, created_at desc);
create index if not exists video_orders_pending_idx on public.video_orders(status, created_at) where status = 'pending';
alter table public.video_orders enable row level security;
drop policy if exists "users access own video orders" on public.video_orders;
create policy "users access own video orders" on public.video_orders for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- Claim atômico: dois workers não conseguem renderizar o mesmo trabalho.
create or replace function public.claim_pending_video_order()
returns setof public.video_orders language plpgsql security definer set search_path = public as $$
declare claimed public.video_orders;
begin
  with candidate as (
    select id from public.video_orders
    where status = 'pending' and attempts < 3
    order by created_at for update skip locked limit 1
  ) update public.video_orders target set status='processing',attempts=target.attempts+1,locked_at=now(),updated_at=now()
  from candidate where target.id=candidate.id returning target.* into claimed;
  if found then return next claimed; end if;
end; $$;
revoke all on function public.claim_pending_video_order() from public;
grant execute on function public.claim_pending_video_order() to service_role;

insert into storage.buckets (id,name,public) values ('video-outputs','video-outputs',true) on conflict (id) do nothing;
