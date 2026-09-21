-- O webhook de remarketing agenda um lead antes do pagamento usando a origem
-- `site_remarketing`. A regra original de `leads.source` foi criada antes
-- desse gatilho e o bloqueava com erro de validação.
alter table public.leads
  drop constraint if exists leads_source_check;

alter table public.leads
  add constraint leads_source_check
  check (source = any (array[
    'site'::text,
    'manual'::text,
    'payment'::text,
    'site_remarketing'::text
  ]));
