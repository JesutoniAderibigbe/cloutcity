-- S42c: real players inside venues, place ids checked against the real place list, and ghost
-- mode.
--
-- 1. presence_beat accepted any well-formed place id. It now accepts only a real place pin
--    (private.presence_places, a copy of data/venues and data/landmarks ids with their boroughs;
--    tests/integration/presence.test.ts checks the two match), in its own borough.
-- 2. A player at a place may announce what they are doing there (an activity enum, never free
--    text), so other players inside the venue see them dancing, at the bar or on a sofa.
-- 3. Ghost mode (CLAUDE.md "Ghost mode removes a player from snapshots and stops their
--    broadcasts"): a profile flag the player sets with presence_set_ghost. A ghost is never
--    online for anyone (snapshots and the online count), and their beats only clear their row.

create table private.presence_places (
  id text primary key
    check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(id) <= 64),
  borough text not null
    check (borough in ('manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'))
);

alter table private.presence_places enable row level security;
revoke all on table private.presence_places from public, anon, authenticated;

insert into private.presence_places (id, borough) values
  ('afterglass', 'manhattan'),
  ('astoria-park', 'queens'),
  ('brickwave', 'brooklyn'),
  ('bronx-ballpark', 'bronx'),
  ('brooklyn-arena', 'brooklyn'),
  ('brooklyn-borough-hall', 'brooklyn'),
  ('brooklyn-bridge', 'brooklyn'),
  ('central-park', 'manhattan'),
  ('city-hall', 'manhattan'),
  ('coney-island-boardwalk', 'brooklyn'),
  ('crown-and-coil-braids', 'queens'),
  ('deco-spire', 'manhattan'),
  ('dumbo', 'brooklyn'),
  ('flushing-main-street', 'queens'),
  ('flushing-meadows', 'queens'),
  ('fold-line-slices', 'queens'),
  ('glowmatic', 'queens'),
  ('golden-hour-roof', 'queens'),
  ('half-court-hangout', 'queens'),
  ('hand-me-up-thrift', 'brooklyn'),
  ('high-line', 'manhattan'),
  ('island-hour-kitchen', 'queens'),
  ('jamaica-station', 'queens'),
  ('kettle-and-clove', 'brooklyn'),
  ('late-lantern-deli', 'queens'),
  ('lift-lane-fitness', 'manhattan'),
  ('manhattan-bridge', 'manhattan'),
  ('midtown-terminal', 'manhattan'),
  ('nenas-window-arepas', 'queens'),
  ('night-shift-pharmacy', 'queens'),
  ('ninth-hour-coffee', 'brooklyn'),
  ('northside-dispatch', 'queens'),
  ('open-door-hall', 'queens'),
  ('overpass-commons', 'queens'),
  ('overtime-espresso', 'manhattan'),
  ('owl-hours-deli', 'manhattan'),
  ('pallet-row-warehouse', 'queens'),
  ('penn-station', 'manhattan'),
  ('pleat-and-steam', 'queens'),
  ('prospect-park', 'brooklyn'),
  ('queens-ballpark', 'queens'),
  ('queens-borough-hall', 'queens'),
  ('queensboro-bridge', 'queens'),
  ('rep-count-gym', 'queens'),
  ('rerun-racks', 'queens'),
  ('september-11-memorial', 'manhattan'),
  ('sidecut-studio', 'manhattan'),
  ('sixth-floor-labs', 'manhattan'),
  ('southpaw-social', 'queens'),
  ('staten-island-ferry', 'staten-island'),
  ('station-30-av', 'queens'),
  ('station-bedford-av', 'brooklyn'),
  ('station-union-sq', 'manhattan'),
  ('statue-of-liberty', 'manhattan'),
  ('steam-tray-halal', 'queens'),
  ('steam-vent-coffee', 'queens'),
  ('steam-window-dumplings', 'manhattan'),
  ('stoop-street-savings', 'queens'),
  ('stoop-strength-gym', 'brooklyn'),
  ('suds-and-socks', 'queens'),
  ('taper-talk-barbers', 'queens'),
  ('ten-tips-nail-bar', 'queens'),
  ('times-square', 'manhattan'),
  ('two-moons-deli', 'brooklyn'),
  ('two-takes-loft', 'queens'),
  ('wallabout-freight', 'brooklyn'),
  ('washington-square-arch', 'manhattan'),
  ('wedge-building', 'manhattan');

-- Rows from before the check may name a place that is not a pin: they are reused by the next beat.
delete from private.player_presence pp
where pp.place_id is not null
  and not exists (select 1 from private.presence_places pl where pl.id = pp.place_id);

alter table private.player_presence
  add column activity text
    check (activity in ('dance', 'bar', 'booth', 'chat', 'lounge', 'idle')),
  add constraint player_presence_activity_at_place check (activity is null or spot = 'place'),
  add constraint player_presence_place_known
    foreign key (place_id) references private.presence_places (id);

alter table private.presence_settings
  add column ghost_toggles_per_minute integer not null default 6
    check (ghost_toggles_per_minute > 0);
alter table private.presence_settings alter column ghost_toggles_per_minute drop default;

-- Only the player's own presence_set_ghost writes it (clients have no update grant on profiles).
alter table public.profiles add column ghost boolean not null default false;

-- The honest online set, now without ghosts.
create or replace function private.presence_online()
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
    and not p.ghost
    and coalesce(private.active_sanction(pp.user_id) not in ('ban', 'suspension'), true);
$$;

revoke execute on function private.presence_online() from public, anon, authenticated;

drop function public.presence_beat(text, text, text);

-- Announces where the caller is and, at a place, what they are doing there (null: nothing
-- announced; the viewer picks a spot). The place must be a real pin in the announced borough.
-- A ghost's beat announces nothing: it only clears their row. Older clients call it without
-- p_activity.
create function public.presence_beat(
  p_spot text, p_place text, p_borough text, p_activity text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_place text;
  v_activity text;
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
    v_place is null
    or not exists (
      select 1 from private.presence_places pl where pl.id = v_place and pl.borough = p_borough
    )
  ) then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  v_activity := case when p_spot = 'place' then p_activity else null end;
  if v_activity is not null
    and v_activity not in ('dance', 'bar', 'booth', 'chat', 'lounge', 'idle') then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;

  perform private.consume_rate_limit(
    v_uid, 'presenceBeat', (private.presence_settings()).beats_per_minute, interval '1 minute'
  );

  if exists (select 1 from public.profiles p where p.id = v_uid and p.ghost) then
    delete from private.player_presence pp where pp.user_id = v_uid;
    return;
  end if;

  insert into private.player_presence as pp (
    user_id, spot, place_id, borough, activity, last_seen
  )
  values (v_uid, p_spot, v_place, p_borough, v_activity, now())
  on conflict (user_id) do update
  set spot = excluded.spot, place_id = excluded.place_id, borough = excluded.borough,
      activity = excluded.activity, last_seen = excluded.last_seen;
end;
$$;

-- As S42, plus each player's announced activity and the caller's own ghost flag (so every
-- device of theirs shows the same setting).
create or replace function public.presence_snapshot()
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
  v_ghost boolean;
  v_players jsonb;
begin
  v_uid := private.require_attestation();
  perform private.require_good_standing(v_uid, 'interact');
  v_settings := private.presence_settings();
  perform private.consume_rate_limit(
    v_uid, 'presenceSnapshot', v_settings.snapshots_per_minute, interval '1 minute'
  );

  select pp.borough into v_borough from private.player_presence pp where pp.user_id = v_uid;
  select coalesce(p.ghost, false) into v_ghost from public.profiles p where p.id = v_uid;
  select count(*)::integer into v_online from private.presence_online();

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'handle', r.handle, 'level', r.level, 'career', r.career, 'avatar', r.avatar,
      'spot', r.spot, 'place', r.place, 'borough', r.borough, 'activity', r.activity
    ) order by r.ord), '[]'::jsonb) into v_players
  from (
    select o.user_id as id, private.public_handle(o.user_id) as handle, p.public_level as level,
      p.career_path as career, p.avatar as avatar, o.spot as spot, o.place_id as place,
      o.borough as borough, o.activity as activity,
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

  return jsonb_build_object(
    'online', v_online, 'ghost', coalesce(v_ghost, false), 'players', v_players
  );
end;
$$;

-- Turns ghost mode on or off. On: the caller leaves every snapshot and the online count at once.
-- Allowed in any standing: it only hides the caller. Rate-limited to ghostTogglesPerMinute.
create function public.presence_set_ghost(p_ghost boolean)
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
  if p_ghost is null then
    raise exception 'invalid_argument' using errcode = 'PT400';
  end if;
  perform private.consume_rate_limit(
    v_uid, 'presenceGhost', (private.presence_settings()).ghost_toggles_per_minute,
    interval '1 minute'
  );
  update public.profiles p set ghost = p_ghost where p.id = v_uid;
  if p_ghost then
    delete from private.player_presence pp where pp.user_id = v_uid;
  end if;
end;
$$;

revoke execute on function public.presence_beat(text, text, text, text) from public, anon;
revoke execute on function public.presence_snapshot() from public, anon;
revoke execute on function public.presence_set_ghost(boolean) from public, anon;
grant execute on function public.presence_beat(text, text, text, text) to authenticated;
grant execute on function public.presence_snapshot() to authenticated;
grant execute on function public.presence_set_ghost(boolean) to authenticated;

comment on function public.presence_set_ghost(boolean) is
  '@standing-exempt: only hides the caller from other players';
