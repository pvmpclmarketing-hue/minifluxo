-- Execute uma vez no SQL Editor do Supabase antes de publicar esta versão.
alter table public.connection_flow_configs
  add column if not exists payment_preview_flow_id uuid references public.flows(id) on delete set null;

alter table public.connection_flow_configs
  add column if not exists payment_generation_flow_id uuid references public.flows(id) on delete set null;

-- Mantém o fluxo de pagamento atual como o fluxo de geração sem prévia.
update public.connection_flow_configs
set payment_generation_flow_id = payment_flow_id
where payment_generation_flow_id is null
  and payment_flow_id is not null;
