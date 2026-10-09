-- S43c: real players doing place-specific things inside every venue interior.
--
-- S42c let a player at a place announce one of six nightlife activities (dance, bar, booth,
-- chat, lounge, idle), checked by a column constraint and inside presence_beat. Every venue type
-- has an interior now (S43b), so a player can also announce what they do at the everyday places:
-- eating, a coffee, a workout or sparring, a cut, a salon session, browsing, a shift, laundry,
-- waiting in line, a studio session or a stroll. The allowed ids move into one table,
-- private.presence_activities, a copy of src/lib/data/presenceActivities.ts
-- (tests/integration/presence.test.ts checks the two match), which the column and the RPC both
-- check. Still an enum on the wire, never free text. Existing rows all hold one of the old ids,
-- which stay in the list, so none is stranded.

create table private.presence_activities (
  id text primary key check (id ~ '^[a-z]+(?:-[a-z]+)*$' and char_length(id) <= 32)
);

alter table private.presence_activities enable row level security;
revoke all on table private.presence_activities from public, anon, authenticated;

insert into private.presence_activities (id) values
  ('dance'),
  ('bar'),
  ('booth'),
  ('chat'),
  ('lounge'),
  ('idle'),
  ('eat'),
  ('sip'),
  ('workout'),
  ('cut'),
  ('style'),
  ('browse'),
  ('work'),
  ('wash'),
  ('wait'),
  ('create'),
  ('stroll');

alter table private.player_presence
  drop constraint player_presence_activity_check,
  add constraint player_presence_activity_known
    foreign key (activity) references private.presence_activities (id);

-- As S42c; the activity is checked against private.presence_activities.
create or replace function public.presence_beat(
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
    and not exists (select 1 from private.presence_activities pa where pa.id = v_activity) then
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
