-- Adintus Saúde · link do paciente (documentos, curvas e evolução por e-mail/WhatsApp)
-- Roda UMA vez no Supabase › SQL Editor. Cria a tabela de links. Ninguém acessa pelo navegador:
-- só a função adintus-link (com a chave de serviço) lê e grava aqui.
create table if not exists public.patient_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  pid text not null,
  pname text,
  clinic text,
  itens text,
  docs jsonb not null default '[]'::jsonb,
  email text,
  v_nasc text,
  v_cpf4 text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  wa_at timestamptz,
  opened_at timestamptz,
  tries int not null default 0,
  locked_until timestamptz
);
create index if not exists patient_links_pid_idx on public.patient_links (pid, created_at desc);
alter table public.patient_links enable row level security;
revoke all on public.patient_links from anon, authenticated;
-- sem nenhuma política: o navegador não lê nem grava; só a função com chave de serviço.

-- ===== Proteções (rodar também): evita links repetidos e limpa os antigos =====
alter table public.patient_links add column if not exists dedupe text;
create index if not exists patient_links_dedupe_idx on public.patient_links (pid, dedupe, created_at desc);
create index if not exists patient_links_creator_idx on public.patient_links (created_by, created_at desc);
-- todo dia às 03:30 UTC apaga links vencidos há mais de 90 dias
select cron.unschedule('adintus-links-limpeza') where exists (select 1 from cron.job where jobname='adintus-links-limpeza');
select cron.schedule('adintus-links-limpeza','30 3 * * *',$$ delete from public.patient_links where expires_at < now() - interval '90 days' $$);

-- ===== Permissão da função (necessária; corrige "Erro inesperado" na ficha) =====
grant usage on schema public to service_role;
grant all on public.patient_links to service_role;
