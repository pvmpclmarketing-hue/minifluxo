-- Execute uma vez no SQL Editor do Supabase.
alter table public.flows add column if not exists share_code text;
update public.flows
set share_code = 'FLW-' || upper(replace(gen_random_uuid()::text, '-', ''))
where share_code is null;
create unique index if not exists flows_share_code_unique_idx on public.flows(share_code);
