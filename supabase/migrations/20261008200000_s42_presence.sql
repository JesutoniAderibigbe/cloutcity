-- S42 phase 1: real players on the map. Players with an account announce where they are with a
-- heartbeat (presence_beat); a signed-in viewer reads who is online, as they may see them
-- (presence_snapshot); signed-out visitors get only the count and anonymous figures through the
-- server's cached route (presence_public_snapshot, service role only). Plan:
-- docs: scratchpad plans/S42-multiplayer.md; CLAUDE.md "Shared live city": online status comes
-- from a heartbeat RPC, never from client-authored Realtime presence.
--
-- What a row holds is coarse on purpose: a spot (at a place, at home, travelling), a place-pin
-- id and a borough. Never coordinates, never an address. A row is "online" while its last beat
-- is younger than online_ttl_s; older rows are invisible and are reused by the next beat.

-- Settings: a copy of data/config/realtime.json `presence` (tests/integration/presence.test.ts
-- checks the two match).
create table private.presence_settings (
  id boolean primary key default true check (id),
  online_ttl_s integer not null check (online_ttl_s between 30 and 600),
  snapshot_max integer not null check (snapshot_max between 1 and 200),
  public_snapshot_max integer not null check (public_snapshot_max between 0 and 200),
  beats_per_minute integer not null check (beats_per_minute > 0),
  snapshots_per_minute integer not null check (snapshots_per_minute > 0)
);

insert into private.presence_settings (
  online_ttl_s, snapshot_max, public_snapshot_max, beats_per_minute, snapshots_per_minute
) values (90, 60, 40, 6, 8);

create table private.player_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  spot text not null check (spot in ('place', 'home', 'travelling')),
  -- A place pin id (data/venues, data/landmarks): only with spot = 'place'.
  place_id text check (place_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(place_id) <= 64),
  borough text not null
    check (borough in ('manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island')),
  last_seen timestamptz not null default now(),
  constraint player_presence_place_pair check ((spot = 'place') = (place_id is not null))
);

create index player_presence_last_seen_idx on private.player_presence (last_seen desc);

alter table private.presence_settings enable row level security;
alter table private.player_presence enable row level security;
revoke all on table private.presence_settings, private.player_presence
  from public, anon, authenticated;

create function private.presence_settings()
returns private.presence_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from private.presence_settings s where s.id;
$$;

revoke execute on function private.presence_settings() from public, anon, authenticated;

-- Players whose last beat is fresh and who are not banned or suspended: the honest online set.
create function private.presence_online()
returns setof private.player_presence
language sql
stable
security definer
set search_path = ''
as $$
  select pp.*
  from private.player_presence pp
  join public.profiles p on p.id = pp.user_id
  where pp.last_seen > now() - make_interval(secs => (private.presence_settings()).online_ttl_s)
    and p.attested
    and p.handle is not null
    and coalesce(private.active_sanction(pp.user_id) not in ('ban', 'suspension'), true);
$$;

revoke execute on function private.presence_online() from public, anon, authenticated;

-- Announces where the caller is. Players with a permanent account only: a guest (an anonymous
-- session from before DEC-62) sees others but never announces. Suspended and banned players are
-- refused by the standing gate. Rate-limited to beatsPerMinute.
create function public.presence_beat(p_spot text, p_place text, p_borough text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_place text;
begin
  v_uid := private.require_attestation();
  perform private.require_good_standing(v_uid, 'interact');
  if exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'guest_not_announced' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.handle is not null) then
    raise exception 'handle_required' using errcode = 'PT409';
  end if;
  if p_spot is null or p_spot not in ('place', 'home', 'travelling') then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  if p_borough is null
    or p_borough not in ('manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island') then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  v_place := case when p_spot = 'place' then p_place else null end;
  if p_spot = 'place' and (
    v_place is null or char_length(v_place) > 64 or v_place !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ) then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;

  perform private.consume_rate_limit(
    v_uid, 'presenceBeat', (private.presence_settings()).beats_per_minute, interval '1 minute'
  );

  insert into private.player_presence as pp (user_id, spot, place_id, borough, last_seen)
  values (v_uid, p_spot, v_place, p_borough, now())
  on conflict (user_id) do update
  set spot = excluded.spot, place_id = excluded.place_id, borough = excluded.borough,
      last_seen = excluded.last_seen;
end;
$$;

-- Leaves the map at once (tab closed, sign-out). Allowed in any standing: it only removes the
-- caller's own row.
create function public.presence_leave()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := private.require_attestation();
  delete from private.player_presence pp where pp.user_id = v_uid;
end;
$$;

-- Who is online, as the caller may see them: never the caller, nobody either of them blocked,
-- nobody the caller muted, no banned or suspended player; a held handle shows as the
-- placeholder. `online` counts every online player (the honest total, the caller included).
-- Rows: the caller's borough first, then the most recent beats; at most snapshotMax.
create function public.presence_snapshot()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_settings private.presence_settings;
  v_borough text;
  v_online integer;
  v_players jsonb;
begin
  v_uid := private.require_attestation();
  perform private.require_good_standing(v_uid, 'interact');
  v_settings := private.presence_settings();
  perform private.consume_rate_limit(
    v_uid, 'presenceSnapshot', v_settings.snapshots_per_minute, interval '1 minute'
  );

  select pp.borough into v_borough from private.player_presence pp where pp.user_id = v_uid;
  select count(*)::integer into v_online from private.presence_online();

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'handle', r.handle, 'level', r.level, 'career', r.career, 'avatar', r.avatar,
      'spot', r.spot, 'place', r.place, 'borough', r.borough
    ) order by r.ord), '[]'::jsonb) into v_players
  from (
    select o.user_id as id, private.public_handle(o.user_id) as handle, p.public_level as level,
      p.career_path as career, p.avatar as avatar, o.spot as spot, o.place_id as place,
      o.borough as borough,
      row_number() over (
        order by (o.borough is not distinct from v_borough) desc, o.last_seen desc, o.user_id
      ) as ord
    from private.presence_online() o
    join public.profiles p on p.id = o.user_id
    where o.user_id <> v_uid
      and not exists (
        select 1 from private.blocked_ids_either(v_uid) b(id) where b.id = o.user_id
      )
      and not exists (
        select 1 from public.mutes m where m.muter_id = v_uid and m.muted_id = o.user_id
      )
    order by ord
    limit v_settings.snapshot_max
  ) r;

  return jsonb_build_object('online', v_online, 'players', v_players);
end;
$$;

-- For signed-out visitors, through the server's cached route (/api/presence) only: the online
-- count and up to publicSnapshotMax figures as a place and a look. No id, handle, level or
-- career: nobody can follow a person without an account.
create function public.presence_public_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'online', (select count(*)::integer from private.presence_online()),
    'figures', coalesce((
      select jsonb_agg(jsonb_build_object('place', f.place_id, 'borough', f.borough, 'look', f.look))
      from (
        select o.place_id, o.borough, p.avatar -> 'look' as look
        from private.presence_online() o
        join public.profiles p on p.id = o.user_id
        where o.spot = 'place'
        order by o.last_seen desc, o.user_id
        limit (private.presence_settings()).public_snapshot_max
      ) f
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.presence_beat(text, text, text) from public, anon;
revoke execute on function public.presence_leave() from public, anon;
revoke execute on function public.presence_snapshot() from public, anon;
revoke execute on function public.presence_public_snapshot() from public, anon, authenticated;
grant execute on function public.presence_beat(text, text, text) to authenticated;
grant execute on function public.presence_leave() to authenticated;
grant execute on function public.presence_snapshot() to authenticated;
grant execute on function public.presence_public_snapshot() to service_role;

comment on function public.presence_leave() is
  '@standing-exempt: removes the caller''s own presence row only';
