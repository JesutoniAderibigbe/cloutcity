-- S19 hardening (security review F3, F7): a ban follows the person's address, not its spelling.
--
-- F3: banned emails were hashed as lower(btrim(email)), so `name+x@domain` or `n.a.m.e@gmail.com`
-- slipped past a ban on `name@domain`. Emails are now canonicalised before hashing:
--   - lower case, surrounding whitespace (any kind) removed;
--   - a `+tag` dropped from the local part, for every domain;
--   - dots dropped from the local part, and googlemail.com read as gmail.com, for Gmail only.
-- Existing ban rows keep their old (legacy) hash: the raw email is never stored, so it cannot be
-- recomputed from the row. Where the banned account still exists, its canonical hash is added
-- now under the same sanction (so lifting the ban lifts both); private.is_banned_identity checks
-- the canonical hash and the legacy one, so a ban whose account is gone still holds.
--
-- F7: a linked identity's email could change after insert without the ban check; the same rule
-- now runs on updates of auth.identities.identity_data.

-- `Name.Surname+game@GoogleMail.com ` → `namesurname@gmail.com`; null for null.
create function private.canonical_email(p_email text)
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
  v_at := length(v_email) - strpos(reverse(v_email), '@') + 1;
  if strpos(v_email, '@') = 0 then
    return v_email;
  end if;
  v_local := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);
  if strpos(v_local, '+') > 0 then
    v_local := left(v_local, strpos(v_local, '+') - 1);
  end if;
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

-- The S18b hash, kept to read bans recorded before canonicalisation.
create function private.legacy_identity_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(lower(btrim(p_email)), s.decrypted_secret, 'sha256'), 'hex')
  from vault.decrypted_secrets s
  where s.name = 'banned_identity_pepper';
$$;

-- New bans (mod_ban) and every check hash the canonical address.
create or replace function private.identity_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.hmac(private.canonical_email(p_email), s.decrypted_secret, 'sha256'),
    'hex'
  )
  from vault.decrypted_secrets s
  where s.name = 'banned_identity_pepper';
$$;

create or replace function private.is_banned_identity(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.banned_identities b
    where b.lifted_at is null
      and b.identity_hash in (
        private.identity_hash(p_email),
        private.legacy_identity_hash(p_email)
      )
  );
$$;

-- Canonical hashes for bans whose account (and so whose email) still exists.
insert into private.banned_identities (identity_hash, kind, sanction_id, created_at, lifted_at)
select private.identity_hash(u.email), b.kind, b.sanction_id, b.created_at, b.lifted_at
from private.banned_identities b
join private.sanctions s on s.id = b.sanction_id
join auth.users u on u.id = s.user_id
where u.email is not null and btrim(u.email) <> ''
  and b.identity_hash = private.legacy_identity_hash(u.email)
on conflict (identity_hash) do nothing;

revoke execute on function private.canonical_email(text) from public, anon, authenticated;
revoke execute on function private.legacy_identity_hash(text) from public, anon, authenticated;
revoke execute on function private.identity_hash(text) from public, anon, authenticated;
revoke execute on function private.is_banned_identity(text) from public, anon, authenticated;

-- F7: the identity ban check on updates too (an identity's email can change after linking).
create trigger s19_refuse_banned_identity_update
  before update of identity_data on auth.identities
  for each row execute function private.refuse_banned_identity_email();

-- The pre-check reads the address the way the hash does: surrounding whitespace of any kind
-- (a pasted tab or newline) is not part of it.
create or replace function public.check_account_email(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_email text;
begin
  v_uid := private.require_attestation();
  perform private.consume_rate_limit(v_uid, 'checkAccountEmail', 10, interval '3600 seconds');
  v_email := regexp_replace(coalesce(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_email is null or length(p_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  if private.active_sanction(v_uid) = 'ban' or private.is_banned_identity(v_email) then
    return 'not_allowed';
  end if;
  return 'ok';
end;
$$;
