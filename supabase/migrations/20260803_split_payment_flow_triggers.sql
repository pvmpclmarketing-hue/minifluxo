-- Pode ser executada novamente com segurança no SQL Editor do Supabase.
-- Corrige contas criadas antes do compartilhamento de fluxos.
alter table public.flows add column if not exists share_code text;

update public.flows
set share_code = 'FLW-' || upper(replace(gen_random_uuid()::text, '-', ''))
where share_code is null;

create unique index if not exists flows_share_code_unique_idx
on public.flows(share_code);

-- Cria os dois gatilhos de pagamento independentes.
alter table public.connection_flow_configs
  add column if not exists payment_preview_flow_id uuid references public.flows(id) on delete set null;

alter table public.connection_flow_configs
  add column if not exists payment_generation_flow_id uuid references public.flows(id) on delete set null;

-- Mantém o fluxo de pagamento atual como o fluxo de geração sem prévia.
update public.connection_flow_configs
set payment_generation_flow_id = payment_flow_id
where payment_generation_flow_id is null
  and payment_flow_id is not null;
