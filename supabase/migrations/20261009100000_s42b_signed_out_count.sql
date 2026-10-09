-- S42b: signed-out visitors get only the online count. S42's signed-out view also answered up to
-- public_snapshot_max anonymous figures (a place and a look); a rare look at a quiet place could
-- single someone out, so the public view is now the honest total and nothing else. Signed-in
-- viewers are unchanged (presence_snapshot).

create or replace function public.presence_public_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('online', (select count(*)::integer from private.presence_online()));
$$;

revoke execute on function public.presence_public_snapshot() from public, anon, authenticated;
grant execute on function public.presence_public_snapshot() to service_role;

alter table private.presence_settings drop column public_snapshot_max;
