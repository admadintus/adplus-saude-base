-- Adintus Saúde · trava contra agendamento duplicado (mesmo profissional, mesmo horário).
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- Regras: ignora cancelados/faltas/vagos (status 11, 22, 15) e agendamentos marcados como "Encaixe".
-- Só verifica quando o profissional, a data, o horário, a duração ou o status mudam
-- (assim, agendamentos que já estão sobrepostos hoje continuam podendo receber check-in/pagamento).

create or replace function public.appt_no_overlap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n_prof text; n_date text; n_start int; n_dur int; n_status text;
begin
  if new.coll <> 'appointments' then return new; end if;
  n_status := coalesce(new.data->>'status', '');
  if coalesce(new.data->>'encaixe', 'false') = 'true' then return new; end if;
  if n_status in ('11','22','15') then return new; end if;
  n_prof  := new.data->>'prof';
  n_date  := new.data->>'date';
  n_start := coalesce((new.data->>'start')::int, 0);
  n_dur   := greatest(coalesce((new.data->>'dur')::int, 15), 1);
  if n_prof is null or n_date is null then return new; end if;
  if tg_op = 'UPDATE' and old.coll = 'appointments'
     and old.data->>'prof' is not distinct from n_prof
     and old.data->>'date' is not distinct from n_date
     and old.data->>'start' is not distinct from new.data->>'start'
     and old.data->>'dur' is not distinct from new.data->>'dur'
     and old.data->>'status' is not distinct from new.data->>'status'
     and old.data->>'encaixe' is not distinct from new.data->>'encaixe' then
    return new;
  end if;
  -- trava por profissional+dia: duas gravações simultâneas passam uma de cada vez
  perform pg_advisory_xact_lock(hashtext('appt:' || n_prof || ':' || n_date));
  if exists (
    select 1 from public.docs d
    where d.coll = 'appointments'
      and d.id <> new.id
      and d.data->>'prof' = n_prof
      and d.data->>'date' = n_date
      and coalesce(d.data->>'status','') not in ('11','22','15')
      and coalesce(d.data->>'encaixe','false') <> 'true'
      and coalesce((d.data->>'start')::int, 0) < n_start + n_dur
      and n_start < coalesce((d.data->>'start')::int, 0) + greatest(coalesce((d.data->>'dur')::int, 15), 1)
  ) then
    raise exception 'agendamento_duplicado' using errcode = 'P0001',
      hint = 'Já existe agendamento deste profissional neste horário.';
  end if;
  return new;
end $$;

drop trigger if exists trg_appt_no_overlap on public.docs;
create trigger trg_appt_no_overlap before insert or update on public.docs
  for each row when (new.coll = 'appointments') execute function public.appt_no_overlap();

-- (opcional, só leitura) lista de sobreposições que já existem hoje:
-- select a.data->>'date' dia, a.data->>'prof' prof, a.data->>'pac' paciente_a, b.data->>'pac' paciente_b
-- from public.docs a join public.docs b on a.coll='appointments' and b.coll='appointments' and a.id<b.id
--  and a.data->>'prof'=b.data->>'prof' and a.data->>'date'=b.data->>'date'
--  and coalesce(a.data->>'status','') not in ('11','22','15') and coalesce(b.data->>'status','') not in ('11','22','15')
--  and (a.data->>'start')::int < (b.data->>'start')::int + coalesce((b.data->>'dur')::int,15)
--  and (b.data->>'start')::int < (a.data->>'start')::int + coalesce((a.data->>'dur')::int,15)
-- order by 1;
