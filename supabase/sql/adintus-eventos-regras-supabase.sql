-- Adintus Saúde · evento ligado a um profissional (ele lê o evento e as regras; inscrições continuam só admin/recepção).
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs for select to authenticated using (
  case
    when coll = 'data/users/' || auth.uid()::text then true
    when public.app_role() is null or public.app_role() = 'pendente' then false
    when coll = 'chatpres' then true
    when coll like 'data/users/%' then public.has_share(coll, data->>'pid')
    when coll = 'prontshare' then (data->>'owner') = auth.uid()::text or (data->>'to') = auth.uid()::text
    when coll in ('chat','chatread') then (data->>'room') = 'all' or position(auth.uid()::text in (data->>'room')) > 0
    when coll in ('professionals','specialties','config') then true
    when coll = 'accesslog' then public.app_role() = 'admin'
    when coll = 'retreq' then public.app_role() = 'admin' or ((data->>'by') = auth.uid()::text and public.app_role() = 'recepcao')
    when coll in ('repasses','profdata','apikeys') then public.app_role() = 'admin'
    when coll = 'patients' then
         public.app_role() in ('admin','recepcao','profissional')
    when coll = 'appointments' then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'notifs' then
         public.app_role() in ('admin','recepcao') or (data->>'to') = public.app_prof()
    when coll = 'blocks' then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'emitidos' then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'events' then
         public.app_role() in ('admin','recepcao') or (public.app_role() = 'profissional' and (data->>'prof') = public.app_prof())
    when coll in ('packages','evregs','cashclose') then public.app_role() in ('admin','recepcao')
    else false
  end);
