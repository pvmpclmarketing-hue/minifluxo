-- Execute uma vez no SQL Editor do Supabase.
-- Impede duas contas ou duas conversas de assumirem o mesmo pedido/retorno da Kie.
create unique index if not exists leads_kie_task_id_unique_idx
  on public.leads(kie_task_id)
  where kie_task_id is not null;

create unique index if not exists leads_owner_external_order_unique_idx
  on public.leads(owner_id, external_order_id)
  where external_order_id is not null;
