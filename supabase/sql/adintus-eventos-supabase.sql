-- Adintus Saúde · liberar a aba Eventos (coleções events e evregs) para administrador e recepção.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.

-- ---------- regras: documentos ----------
-- leitura
drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs for select to authenticated using (
  case
    when coll = 'data/users/' || auth.uid()::text then true            -- notas privadas do próprio usuário
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
    when coll in ('packages','events','evregs') then public.app_role() in ('admin','recepcao')
    else false
  end);

-- escrita (insert)
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (
  case
    when coll = 'data/users/' || auth.uid()::text then true
    when public.app_role() is null or public.app_role() = 'pendente' then false
    when coll = 'chat' then (data->>'from') = auth.uid()::text and ((data->>'room') = 'all' or position(auth.uid()::text in (data->>'room')) > 0)
    when coll = 'chatread' then (data->>'uid') = auth.uid()::text and id like auth.uid()::text || '\_\_%'
    when coll = 'retreq' then (data->>'by') = auth.uid()::text and (data->>'status') = 'pending' and public.app_role() in ('admin','recepcao')
    when coll = 'accesslog' then (data->>'uid') = auth.uid()::text and public.app_role() in ('admin','recepcao','profissional')
    when coll = 'chatpres' then id = auth.uid()::text
    when coll = 'prontshare' then (data->>'owner') = auth.uid()::text and (data->>'to') <> auth.uid()::text and public.app_role() = 'profissional'
    when coll in ('professionals','specialties','config','repasses','profdata','apikeys') then public.app_role() = 'admin'
    when coll in ('patients','appointments') then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'notifs' then public.app_role() in ('admin','recepcao','profissional')
    when coll = 'blocks' then public.app_role() in ('admin','recepcao')
    when coll = 'emitidos' then public.app_role() = 'profissional' and (data->>'prof') = public.app_prof()
    when coll in ('packages','events','evregs') then public.app_role() in ('admin','recepcao')
    else false
  end);

-- escrita (update)
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated using (
  case
    when coll = 'data/users/' || auth.uid()::text then true
    when public.app_role() is null or public.app_role() = 'pendente' then false
    when coll = 'chat' then false
    when coll = 'retreq' then public.app_role() = 'admin'
    when coll = 'chatread' then (data->>'uid') = auth.uid()::text and id like auth.uid()::text || '\_\_%'
    when coll = 'chatpres' then id = auth.uid()::text
    when coll = 'prontshare' then (data->>'owner') = auth.uid()::text and (data->>'to') <> auth.uid()::text and public.app_role() = 'profissional'
    when coll in ('professionals','specialties','config','repasses','profdata','apikeys') then public.app_role() = 'admin'
    when coll in ('patients','appointments') then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'notifs' then
         public.app_role() in ('admin','recepcao') or (data->>'to') = public.app_prof()
    when coll = 'blocks' then public.app_role() in ('admin','recepcao')
    when coll in ('packages','events','evregs') then public.app_role() in ('admin','recepcao')
    else false
  end) with check (
  case
    when coll = 'data/users/' || auth.uid()::text then true
    when public.app_role() is null or public.app_role() = 'pendente' then false
    when coll = 'chat' then false
    when coll = 'retreq' then public.app_role() = 'admin'
    when coll = 'chatread' then (data->>'uid') = auth.uid()::text and id like auth.uid()::text || '\_\_%'
    when coll = 'chatpres' then id = auth.uid()::text
    when coll = 'prontshare' then (data->>'owner') = auth.uid()::text and (data->>'to') <> auth.uid()::text and public.app_role() = 'profissional'
    when coll in ('professionals','specialties','config','repasses','profdata','apikeys') then public.app_role() = 'admin'
    when coll in ('patients','appointments') then
         public.app_role() in ('admin','recepcao') or (data->>'prof') = public.app_prof()
    when coll = 'notifs' then
         public.app_role() in ('admin','recepcao') or (data->>'to') = public.app_prof()
    when coll = 'blocks' then public.app_role() in ('admin','recepcao')
    when coll in ('packages','events','evregs') then public.app_role() in ('admin','recepcao')
    else false
  end);

-- escrita (delete)
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (
  case
    when coll = 'data/users/' || auth.uid()::text then true
    when coll like 'data/users/%' then false
    when coll = 'accesslog' then false
    when coll = 'prontshare' then (data->>'owner') = auth.uid()::text or (data->>'to') = auth.uid()::text
    when public.app_role() = 'admin' then true
    when public.app_role() = 'recepcao' then coll in ('appointments','notifs','blocks')
    else false
  end);
