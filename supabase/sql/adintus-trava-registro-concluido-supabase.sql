-- Adintus Saúde · trava no banco dos registros clínicos concluídos e do log de acessos.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- 1) Registro clínico (coleção data/users/...) com "done": true não pode mais ser alterado nem apagado.
--    Vale para qualquer usuário, inclusive o administrador, e mesmo se o aplicativo falhar.
--    Correções entram como novo registro (retificação), nunca por cima do original.
-- 2) O log de acessos (accesslog) só aceita inclusão: não pode ser alterado nem apagado.
-- Para uma correção excepcional, é preciso desligar a trava de propósito no SQL Editor
-- (alter table public.docs disable trigger docs_trava_concluido;) e ligar de novo depois
-- (alter table public.docs enable trigger docs_trava_concluido;).

create or replace function public.docs_trava_concluido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    if old.coll like 'data/users/%' and coalesce(old.data->>'done','false') = 'true' then
      raise exception 'Registro clínico concluído não pode ser alterado nem apagado. Crie uma retificação.'
        using errcode = 'P0001';
    end if;
    if old.coll = 'accesslog' then
      raise exception 'O log de acessos não pode ser alterado nem apagado.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists docs_trava_concluido on public.docs;
create trigger docs_trava_concluido
  before update or delete on public.docs
  for each row execute function public.docs_trava_concluido();
