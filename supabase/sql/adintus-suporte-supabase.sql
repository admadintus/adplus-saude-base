-- Adintus Saúde · suporte e vigilância (tabelas e agendamentos)
-- Rode UMA vez no Supabase › SQL Editor. Pode rodar de novo sem problema.
-- Não precisa colar segredo: os agendamentos reaproveitam o segredo do agendamento da agenda por e-mail.

-- 1) Tabelas. Ficam fechadas para o navegador: só a função "adintus-suporte" (chave de serviço) lê e grava.
create table if not exists public.suporte_pedidos (
  id uuid primary key default gen_random_uuid(),
  criado timestamptz not null default now(),
  user_id uuid,
  email text,
  nome text,
  tipo text not null default 'duvida',
  texto text not null,
  ctx jsonb not null default '{}'::jsonb,
  print text,
  status text not null default 'novo',
  categoria text,
  urgencia text,
  resumo text,
  sugestao text,
  resposta text,
  respondido timestamptz
);
create index if not exists suporte_pedidos_criado_idx on public.suporte_pedidos (criado desc);
create index if not exists suporte_pedidos_user_idx on public.suporte_pedidos (user_id, criado desc);

create table if not exists public.suporte_erros (
  sig text primary key,
  msg text,
  stack text,
  pagina text,
  ver text,
  qtd integer not null default 1,
  primeiro timestamptz not null default now(),
  ultimo timestamptz not null default now(),
  usuarios jsonb not null default '[]'::jsonb,
  avisado boolean not null default false,
  resolvido boolean not null default false
);
create index if not exists suporte_erros_ultimo_idx on public.suporte_erros (ultimo desc);

create table if not exists public.suporte_estado (
  chave text primary key,
  valor jsonb,
  atualizado timestamptz not null default now()
);

alter table public.suporte_pedidos enable row level security;
alter table public.suporte_erros enable row level security;
alter table public.suporte_estado enable row level security;
revoke all on public.suporte_pedidos, public.suporte_erros, public.suporte_estado from anon, authenticated;
grant all on public.suporte_pedidos, public.suporte_erros, public.suporte_estado to service_role;

-- 2) Agendamentos (usam pg_cron e pg_net, que a agenda por e-mail já ligou).
-- O segredo é copiado do agendamento "adintus-agenda-email" (o mesmo AGENDA_CRON_SECRET), sem passar por ninguém.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare sec text;
begin
  select substring(command from 'x-cron-secret'',''([^'']+)''') into sec from cron.job where jobname = 'adintus-agenda-email';
  if sec is null or sec = 'COLE_AQUI_O_SEGREDO' then
    raise exception 'Não achei o segredo no agendamento da agenda por e-mail. Rode primeiro o SQL da agenda (adintus-agenda-email-supabase.sql).';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('adintus-suporte-resumo','adintus-suporte-ping');
  -- Resumo diário: 11:00 UTC = 08:00 em Brasília.
  perform cron.schedule('adintus-suporte-resumo', '0 11 * * *', format($c$ select net.http_post(
      url := 'https://umkrepbjtnjwzgpujgxi.supabase.co/functions/v1/adintus-suporte',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L),
      body := '{"acao":"resumo"}'::jsonb) $c$, sec));
  -- Conferência do site e do banco a cada 10 minutos.
  perform cron.schedule('adintus-suporte-ping', '*/10 * * * *', format($c$ select net.http_post(
      url := 'https://umkrepbjtnjwzgpujgxi.supabase.co/functions/v1/adintus-suporte',
      headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L),
      body := '{"acao":"ping"}'::jsonb) $c$, sec));
end $$;
-- Para pausar:  select cron.unschedule('adintus-suporte-resumo');  select cron.unschedule('adintus-suporte-ping');
