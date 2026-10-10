alter table public.connection_flow_configs
  add column if not exists relationship_flow_id uuid references public.flows(id) on delete set null,
  add column if not exists relationship_template_name text,
  add column if not exists relationship_template_language text;
