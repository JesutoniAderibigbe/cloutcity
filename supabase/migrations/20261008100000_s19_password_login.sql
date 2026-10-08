-- S19 password accounts (DEC-61): players log in with their username or email and a password; no
-- email service. Logging in by username goes through the server (POST /api/auth/login), which
-- looks the account's email up with the service role and signs in on the player's behalf. Both
-- functions here are for that route only: service role, never a client.

-- Login attempts per IP and per identifier, keyed by a SHA-256 the server computes (an IP or a
-- typed username/email is never stored in the clear).
create table private.login_attempts (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('ip', 'identifier')),
  window_started_at timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (key_hash, bucket)
);

alter table private.login_attempts enable row level security;
revoke all on table private.login_attempts from public, anon, authenticated, service_role;

-- Counts one attempt against a fixed window (data/config/account.json `login`); raises 429
-- rate_limited once `p_max` is used up. Same shape as private.consume_rate_limit (S18a), keyed
-- by a hash instead of a user id. Windows long past are swept as a side effect.
create function public.consume_login_attempt(
  p_key_hash text,
  p_bucket text,
  p_max integer,
  p_window_ms integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window interval;
  v_hits integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_bucket is null or p_bucket not in ('ip', 'identifier')
    or p_max is null or p_max < 1 or p_window_ms is null or p_window_ms < 1000 then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  v_window := make_interval(secs => p_window_ms / 1000.0);

  insert into private.login_attempts as a (key_hash, bucket, window_started_at, hits)
  values (p_key_hash, p_bucket, now(), 1)
  on conflict (key_hash, bucket) do update
  set hits = case when a.window_started_at <= now() - v_window then 1 else a.hits + 1 end,
      window_started_at = case
        when a.window_started_at <= now() - v_window then now()
        else a.window_started_at
      end
  returning a.hits into v_hits;

  delete from private.login_attempts a
  where a.bucket = p_bucket and a.window_started_at < now() - greatest(v_window, interval '1 day');

  if v_hits > p_max then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
end;
$$;

-- The email of the saved (non-guest) account holding this username, or null. Usernames are
-- public (any player sees them), so this reveals nothing beyond what the route does with it.
create function public.login_email_for_handle(p_handle text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.handles h
  join auth.users u on u.id = h.user_id
  where h.handle_key = private.handle_key(btrim(coalesce(p_handle, ''), ' @'))
    and h.released_at is null
    and not u.is_anonymous
    and u.email is not null and u.email <> ''
  limit 1;
$$;

revoke execute on function public.consume_login_attempt(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text, text, integer, integer)
  to service_role;
revoke execute on function public.login_email_for_handle(text) from public, anon, authenticated;
grant execute on function public.login_email_for_handle(text) to service_role;
