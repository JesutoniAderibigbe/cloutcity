-- S19 accounts: a guest saves their progress by adding an email (updateUser, confirmed through a
-- link) or Google (linkIdentity) to the same anonymous user, so the profile, its attestation and
-- consent, the handle and the cloud save all stay where they are: nothing here moves data.
--
-- What this adds:
--  - public.check_account_email: the friendly pre-check the account sheet calls before sending a
--    link, so a banned email gets a plain answer instead of a server error;
--  - triggers on auth.users and auth.identities: the authoritative refusal of a banned email (or
--    of any email on a banned account), however GoTrue is called (email change, Google link, a
--    new Google user);
--  - private.require_permanent: the gate for later features that need a saved account (S26),
--    read from auth.users, never from the JWT's is_anonymous claim (stale until a refresh).
--
-- Nothing here logs or stores an email in the clear: banned emails are peppered hashes
-- (private.identity_hash, S18b).

-- The pre-check. 'ok' or 'not_allowed' (a banned email, or a banned caller); the email itself is
-- never stored or logged. A suspended or restricted player may still save their own progress.
-- The rate limit (data/config/account.json emailCheck, src/lib/account/parity.test.ts) keeps it
-- from being a fast oracle for which emails are banned.
create function public.check_account_email(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := private.require_attestation();
  perform private.consume_rate_limit(v_uid, 'checkAccountEmail', 10, interval '3600 seconds');
  if p_email is null or length(p_email) > 320 or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  if private.active_sanction(v_uid) = 'ban' or private.is_banned_identity(p_email) then
    return 'not_allowed';
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.check_account_email(text) from public, anon;
grant execute on function public.check_account_email(text) to authenticated;
comment on function public.check_account_email(text) is
  'S19: whether an email may be used to save this player''s progress (ok | not_allowed).
@standing-exempt: saving progress is the player''s own account, open to a suspended player';

-- Refuses a banned email on auth.users (a new user, an email change being requested or
-- confirmed) and on a banned account adding any email. Raised as a plain error: GoTrue answers
-- with a server error, which the client shows as "That email can't be used here".
create function private.refuse_banned_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_email text;
  v_old_change text;
begin
  if tg_op = 'UPDATE' then
    v_old_email := old.email;
    v_old_change := old.email_change;
  end if;
  if new.email is not null and new.email <> '' and new.email is distinct from v_old_email then
    if private.is_banned_identity(new.email) or private.active_sanction(new.id) = 'ban' then
      raise exception 'email_not_allowed' using errcode = 'P0001';
    end if;
  end if;
  if new.email_change is not null and new.email_change <> ''
    and new.email_change is distinct from v_old_change then
    if private.is_banned_identity(new.email_change) or private.active_sanction(new.id) = 'ban' then
      raise exception 'email_not_allowed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- The same rule for a linked identity (Google, or the email identity GoTrue adds on confirm).
create function private.refuse_banned_identity_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(new.identity_data ->> 'email', '');
begin
  if v_email is not null and private.is_banned_identity(v_email) then
    raise exception 'email_not_allowed' using errcode = 'P0001';
  end if;
  if private.active_sanction(new.user_id) = 'ban' then
    raise exception 'email_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function private.refuse_banned_user_email() from public, anon, authenticated;
revoke execute on function private.refuse_banned_identity_email()
  from public, anon, authenticated;

create trigger s19_refuse_banned_email_insert
  before insert on auth.users
  for each row execute function private.refuse_banned_user_email();

create trigger s19_refuse_banned_email_update
  before update of email, email_change on auth.users
  for each row execute function private.refuse_banned_user_email();

create trigger s19_refuse_banned_identity
  before insert on auth.identities
  for each row execute function private.refuse_banned_identity_email();

-- For features that need a saved account (S26): the caller's id, or 401 / 403
-- attestation_required / 403 account_required for a guest that has not saved their progress.
create function private.require_permanent()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_attestation();
begin
  if not exists (select 1 from auth.users u where u.id = v_uid and not u.is_anonymous) then
    raise exception 'account_required' using errcode = 'PT403';
  end if;
  return v_uid;
end;
$$;

revoke execute on function private.require_permanent() from public, anon, authenticated;
