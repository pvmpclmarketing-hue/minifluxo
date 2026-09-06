create table if not exists public.lyric_video_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  status text not null default 'pending' check (status in ('pending', 'processing', 'rendering', 'complete', 'failed')),
  audio_url text not null,
  lyrics text not null,
  lyrics_timestamps jsonb,
  timing_source text check (timing_source in ('provided', 'estimated')),
  intro_text text,
  theme text not null default 'romantic_rose' check (theme in ('romantic_rose', 'night_love', 'soft_gold')),
  shotstack_render_id text unique,
  output_url text,
  duration integer not null default 60 check (duration = 60),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lyric_video_orders_owner_created_idx on public.lyric_video_orders(owner_id, created_at desc);
create index if not exists lyric_video_orders_render_idx on public.lyric_video_orders(shotstack_render_id) where shotstack_render_id is not null;

alter table public.lyric_video_orders enable row level security;
grant select, insert, update, delete on public.lyric_video_orders to authenticated;

create policy "users access own lyric video orders"
  on public.lyric_video_orders
  for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
