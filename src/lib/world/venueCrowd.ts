/**
 * Who is inside a venue (S43): the locals of a venue interior, as pure, deterministic maths with
 * no three or React import. The interior's chunk draws what this returns
 * (src/scene/venue/crowdLayer.ts).
 *
 * - How many: its staff (the DJ, the bartender) whenever it is open, and the rest of the tier's
 *   crowd at the hour's share (data/interiors/venues/<id>.json `crowd.hours`), all of it on busy
 *   nights and `quietShare` of it on others; nobody while the venue is closed.
 * - Where: spots fill by rank (the dance floor and the bar before the corners), ties broken by a
 *   shuffle seeded by the venue and the night, so a crowd that grows keeps the locals already
 *   there and the same night always looks the same. Spots real players take (`taken`) and spots
 *   in a pose the tier does not draw are left out (a standing local's pose falls back to `talk`,
 *   else `idle`).
 * - Who: each local's body, height, colours, small offset and turn, and groove phase are seeded
 *   by the spot and the night, so locals differ but never flicker between renders.
 *
 * Locals are NPCs, never players (UX-3): the scene draws them from the pedestrian kits, with no
 * name tag, and nothing here is ever counted as "here now".
 */

export interface CrowdSpot {
  readonly id: string
  readonly activity: string
  readonly pose: string
  readonly x: number
  /** Seat height (0 standing). */
  readonly y: number
  readonly z: number
  readonly headingRad: number
  readonly rank: number
  readonly staff: boolean
}

export interface CrowdPalette {
  readonly skin: readonly string[]
  readonly tops: readonly string[]
  readonly bottoms: readonly string[]
  readonly accents: readonly string[]
}

export interface CrowdInput {
  readonly spots: readonly CrowdSpot[]
  /** [hour, share] for each opening hour. */
  readonly hours: readonly (readonly [number, number])[]
  readonly busyDays: readonly number[]
  readonly quietShare: number
  /** The tier's locals at a full hour. */
  readonly max: number
  /** Poses the tier draws. */
  readonly poses: ReadonlySet<string>
  /** 1: the man's body only (the low tier); 2: both. */
  readonly bodies: number
  /** The personal clock's minute (absolute). */
  readonly minute: number
  readonly minutesPerDay: number
  /** Days in the clock's week (the clock's `dayOfWeek` runs 1..daysPerWeek). */
  readonly daysPerWeek: number
  readonly open: boolean
  /** The venue's id: each venue's crowd differs. */
  readonly seed: string
  /** Spot ids real players stand at. */
  readonly taken?: ReadonlySet<string>
  readonly jitterM: number
  readonly headingJitterRad: number
  readonly heightM: { readonly min: number; readonly max: number }
  readonly palette: CrowdPalette
}

export interface CrowdMember {
  readonly spot: string
  readonly activity: string
  readonly pose: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly headingRad: number
  /** 0 the woman's body, 1 the man's (src/scene/avatar/npc.ts order). */
  readonly body: 0 | 1
  readonly heightM: number
  readonly colors: {
    readonly skin: string
    readonly top: string
    readonly bottom: string
    readonly accent: string
  }
  /** 0–1: where in the beat this local's groove starts. */
  readonly phase: number
}

/** What a standing local does instead when the tier draws not their pose, best first. */
const STANDING_FALLBACKS = ['talk', 'idle'] as const
const MINUTES_PER_HOUR = 60

/** FNV-1a: a stable 32-bit hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a small seeded generator of numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(list: readonly T[], random: () => number): T => {
  const value = list[Math.floor(random() * list.length) % list.length]
  if (value === undefined) throw new Error('venueCrowd: empty palette')
  return value
}

/**
 * Which night `minute` belongs to: the game day it started on, the day turning at noon, so a
 * night out past midnight keeps one crowd.
 */
export function nightOf(minute: number, minutesPerDay: number): number {
  return Math.floor((minute - minutesPerDay / 2) / minutesPerDay)
}

/** The share of the crowd in at `minute` (0 for an hour not listed). */
export function hourShare(
  hours: readonly (readonly [number, number])[],
  minute: number,
  minutesPerDay: number,
): number {
  const ofDay = ((minute % minutesPerDay) + minutesPerDay) % minutesPerDay
  const hour = Math.floor(ofDay / MINUTES_PER_HOUR)
  return hours.find(([at]) => at === hour)?.[1] ?? 0
}

/** The pose a spot is drawn in on this tier, or null when the tier has no fitting pose. */
function poseOn(spot: CrowdSpot, poses: ReadonlySet<string>): string | null {
  if (poses.has(spot.pose)) return spot.pose
  // A standing local (idle, at work, on a treadmill) can talk or stand instead; a seated or
  // dancing one has no stand-in.
  if (spot.y !== 0 || spot.pose === 'dance') return null
  return STANDING_FALLBACKS.find((pose) => poses.has(pose)) ?? null
}

/** How many locals are in now: zero while closed, at least the staff while open. */
export function crowdSize(input: CrowdInput, staff: number): number {
  if (!input.open) return 0
  const share = hourShare(input.hours, input.minute, input.minutesPerDay)
  // The night belongs to the day it started on (a 01:00 crowd is the evening before's).
  const night = nightOf(input.minute, input.minutesPerDay)
  const dayOfWeek = (((night % input.daysPerWeek) + input.daysPerWeek) % input.daysPerWeek) + 1
  const busy = input.busyDays.includes(dayOfWeek)
  // The staff are in all night; the hour and the night decide how full the rest is.
  const guests = Math.round((input.max - staff) * share * (busy ? 1 : input.quietShare))
  return Math.min(input.max, staff + Math.max(0, guests))
}

/** The locals inside now, staff first, then by rank (src/scene/venue renders them). */
export function planCrowd(input: CrowdInput): CrowdMember[] {
  const night = nightOf(input.minute, input.minutesPerDay)
  const order = seeded(hashString(`${input.seed}:${night}`))
  const usable = input.spots
    .map((spot) => ({ spot, pose: poseOn(spot, input.poses), key: order() }))
    .filter(
      (entry): entry is { spot: CrowdSpot; pose: string; key: number } =>
        entry.pose !== null && !(input.taken?.has(entry.spot.id) ?? false),
    )
  const staff = usable.filter((entry) => entry.spot.staff).length
  const size = Math.min(usable.length, crowdSize(input, Math.min(staff, input.max)))
  usable.sort((a, b) => {
    if (a.spot.staff !== b.spot.staff) return a.spot.staff ? -1 : 1
    return a.spot.rank - b.spot.rank || a.key - b.key
  })
  return usable.slice(0, size).map(({ spot, pose }) => {
    const random = seeded(hashString(`${input.seed}:${night}:${spot.id}`))
    const seated = spot.y > 0
    // Seated locals and staff keep their exact place; the rest shuffle a little.
    const jitter = seated || spot.staff ? 0 : input.jitterM
    const angle = random() * Math.PI * 2
    const reach = random() * jitter
    const turn = seated ? 0 : (random() * 2 - 1) * input.headingJitterRad
    const body: 0 | 1 = input.bodies < 2 ? 1 : random() < 0.5 ? 0 : 1
    return {
      spot: spot.id,
      activity: spot.activity,
      pose,
      x: spot.x + Math.cos(angle) * reach,
      y: spot.y,
      z: spot.z + Math.sin(angle) * reach,
      headingRad: spot.headingRad + turn,
      body,
      heightM: input.heightM.min + random() * (input.heightM.max - input.heightM.min),
      colors: {
        skin: pick(input.palette.skin, random),
        top: pick(input.palette.tops, random),
        bottom: pick(input.palette.bottoms, random),
        accent: pick(input.palette.accents, random),
      },
      phase: random(),
    }
  })
}

/**
 * Where an occupant doing `activity` goes, best first: the interior's `players` list for it
 * (S43c: a workout takes a treadmill, then a rack), else spots of the activity's own name.
 */
export function wantedSpots(
  activity: string,
  players: Readonly<Record<string, readonly string[] | undefined>>,
): readonly string[] {
  return players[activity] ?? [activity]
}

/**
 * The spots real players take (S43 hook): each occupant's activity at the first free spot it
 * wants (`wantedSpots`, best rank first; a staff spot only when the interior's `players` names
 * it, so a player on shift stands behind the counter), else any free standing guest spot; extra
 * occupants stand at none.
 */
export function placeOccupants(
  spots: readonly CrowdSpot[],
  activities: readonly string[],
  players: Readonly<Record<string, readonly string[] | undefined>> = {},
): (CrowdSpot | null)[] {
  const free = [...spots].sort((a, b) => a.rank - b.rank)
  return activities.map((activity) => {
    const named = players[activity] !== undefined
    let index = -1
    for (const want of wantedSpots(activity, players)) {
      index = free.findIndex((spot) => spot.activity === want && (named || !spot.staff))
      if (index >= 0) break
    }
    if (index < 0) index = free.findIndex((spot) => !spot.staff && spot.y === 0)
    if (index < 0) return null
    const [spot] = free.splice(index, 1)
    return spot ?? null
  })
}
