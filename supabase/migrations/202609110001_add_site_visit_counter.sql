create table if not exists public.site_visit_daily (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  path text not null check (path ~ '^/[a-z0-9/_-]*$'),
  visit_date date not null default (timezone('America/Sao_Paulo', now()))::date,
  created_at timestamptz not null default now(),
  unique (visitor_id, path, visit_date)
);

alter table public.site_visit_daily enable row level security;
create index if not exists site_visit_daily_date_idx on public.site_visit_daily (visit_date desc);
create index if not exists site_visit_daily_path_date_idx on public.site_visit_daily (path, visit_date desc);
