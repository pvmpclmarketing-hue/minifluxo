-- Two full-song lyric videos belong to one lead/card pair.  Keeping that
-- relationship in the render queue makes completion and delivery idempotent.
alter table public.video_orders
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists flow_node_id text,
  add column if not exists variant_index smallint,
  add column if not exists background_url text;

alter table public.video_orders
  drop constraint if exists video_orders_variant_index_check,
  add constraint video_orders_variant_index_check check (variant_index is null or variant_index between 1 and 2);

create index if not exists video_orders_lead_node_idx
  on public.video_orders(lead_id, flow_node_id, status, created_at desc)
  where lead_id is not null;
