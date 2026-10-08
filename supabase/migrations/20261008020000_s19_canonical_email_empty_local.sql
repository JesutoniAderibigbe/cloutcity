-- S19 hardening (security review N2): `+tag@domain` has nothing before the tag, so dropping the
-- tag left an empty local part (`@domain`), which every such address would share. An address
-- whose local part would be empty is hashed as written (lower case, trimmed) instead.
create or replace function private.canonical_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(regexp_replace(coalesce(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  v_at integer;
  v_local text;
  v_domain text;
begin
  if p_email is null then
    return null;
  end if;
  if strpos(v_email, '@') = 0 then
    return v_email;
  end if;
  v_at := length(v_email) - strpos(reverse(v_email), '@') + 1;
  v_local := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);
  if strpos(v_local, '+') > 0 then
    v_local := left(v_local, strpos(v_local, '+') - 1);
  end if;
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  if v_local = '' then
    return v_email;
  end if;
  return v_local || '@' || v_domain;
end;
$$;

revoke execute on function private.canonical_email(text) from public, anon, authenticated;
