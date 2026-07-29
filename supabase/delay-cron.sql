-- Execute uma unica vez no SQL Editor do Supabase depois de criar DELAY_CRON_SECRET na Vercel.
-- Troque os dois valores entre <...>. Use um segredo longo e igual nos dois lugares.
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
