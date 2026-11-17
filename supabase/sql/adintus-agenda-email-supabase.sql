-- Adintus Saúde · agendamento do e-mail noturno da agenda
-- Roda UMA vez no Supabase › SQL Editor. Antes, troque COLE_AQUI_O_SEGREDO pelo mesmo texto que você
-- colocou no segredo AGENDA_CRON_SECRET (Edge Functions › Secrets). Não mande esse texto no chat.
-- Horário: 23:00 UTC = 20:00 em Brasília (o Brasil não usa horário de verão hoje).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('adintus-agenda-email') where exists (select 1 from cron.job where jobname='adintus-agenda-email');

select cron.schedule(
  'adintus-agenda-email',
  '0 23 * * *',
  $$ select net.http_post(
       url := 'https://umkrepbjtnjwzgpujgxi.supabase.co/functions/v1/adintus-agenda-email',
       headers := jsonb_build_object('content-type','application/json','x-cron-secret','COLE_AQUI_O_SEGREDO'),
       body := '{}'::jsonb
     ) $$
);
-- Para pausar:  select cron.unschedule('adintus-agenda-email');
