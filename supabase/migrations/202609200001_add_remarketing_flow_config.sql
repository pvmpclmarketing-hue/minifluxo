alter table public.connection_flow_configs
  add column if not exists remarketing_flow_id uuid references public.flows(id) on delete set null;

-- O valor é selecionado pelo painel por conexão; esta migração somente habilita
-- o novo gatilho sem assumir que todos os clientes usam remarketing.
