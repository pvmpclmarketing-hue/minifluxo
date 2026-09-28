-- Número reserva: só é usado depois que o template oficial permanece sem
-- resposta. Ele não substitui o canal Meta usado pelos sites e pagamentos.
alter table public.connection_flow_configs
  add column if not exists backup_connection_id uuid references public.connections(id) on delete set null,
  add column if not exists backup_flow_id uuid references public.flows(id) on delete set null,
  add column if not exists backup_response_timeout_minutes integer not null default 50
    check (backup_response_timeout_minutes between 5 and 1440);

