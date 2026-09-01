-- Referência do agendador de delays do WhatsEntregavel.
-- A configuração de produção foi instalada em 01/09/2026:
--   - extensões pg_cron e pg_net ativas;
--   - segredo armazenado somente no Supabase Vault e na Vercel;
--   - job whatsentregavel-flow-delays executando a cada minuto.
--
-- Não substitua <SEGREDO_DO_DELAY_CRON> por uma chave real neste arquivo e não
-- faça commit de segredos. Para reinstalar, gere um novo segredo, salve-o como
-- DELAY_CRON_SECRET na Vercel e grave o mesmo valor no Vault antes de executar
-- o agendamento abaixo.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<SEGREDO_DO_DELAY_CRON>', 'whatsentregavel_delay_cron_secret')
where not exists (select 1 from vault.secrets where name = 'whatsentregavel_delay_cron_secret');

select cron.unschedule(jobid)
from cron.job
where jobname = 'whatsentregavel-flow-delays';

select cron.schedule(
  'whatsentregavel-flow-delays',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://minifluxo.vercel.app/api/cron/flow-delays',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'whatsentregavel_delay_cron_secret')
      ),
      body := jsonb_build_object('source', 'supabase-cron'),
      timeout_milliseconds := 10000
    );
  $$
);
