/**
 * The townsfolk (S04o): Sims-like locals who hang out at the places and walk between them, drawn
 * at the player's size so the map reads as a lived-in city at its default view (the ambient
 * pedestrians stay real-sized on the sidewalks). NPCs, never players (UX-3): no ring, no chip,
 * never counted, and their card says "Local".
 *
 * Every local belongs to a place (`perVenue` of them) and lives in staggered cycles of `epochS`.
 * Each cycle it is at one place (home, or one of its home's `neighbours` nearest places within a
 * walk of `maxWalkShare` of a cycle), standing on a ring in front of that place in a pose (idle,
 * talking to the ring's centre, or waving at the camera), and at the end of the cycle it walks
 * straight to the next cycle's place. Everything is a pure function of (seed, place, slot, city
 * time): a reload, or another device, shows the same local at the same spot.
 *
 * Positions on the ring are in local heights (`h`), since locals are drawn at a size that follows
 * the camera distance, like the player: the ring grows with them and never crowds.
 */
import { createRng } from '../streetProps'
import { hash01, hashInt } from './path'
import type { AmbientTier, TownsfolkConfig, TownsfolkPose } from './types'

/** A place locals hang out at, in local metres (x east, y north). */
export interface TownsfolkVenue {
  readonly id: string
  readonly x: number
  readonly y: number
}

/** The two body variants, in kit order (src/scene/ambient/kitIds.ts TOWNSFOLK_VARIANTS). */
export const TOWNSFOLK_BODIES = ['woman', 'man'] as const
export type TownsfolkBody = (typeof TOWNSFOLK_BODIES)[number]

/** Who a local is: what their card shows. */
export interface TownsfolkProfile {
  /** `<place id>#<slot>`: stable across reloads and devices. */
  readonly id: string
  readonly name: string
  readonly body: TownsfolkBody
  /** Copy key suffix: `townsfolk.vibe.<vibe>`. */
  readonly vibe: string
  /** The place they call home. */
  readonly homeId: string
}

export interface Resident {
  readonly profile: TownsfolkProfile
  readonly home: number
  readonly slot: number
  readonly hash: number
  readonly body: number
  readonly skin: number
  readonly top: number
  readonly bottom: number
  readonly hair: number
}

/** Where one local stands now. Mutable and reused (no allocation per tick). */
export interface TownsfolkSample {
  /** Index into `residents`. */
  resident: number
  x: number
  y: number
  yaw: number
  /** Metres above the ground (the walking bob). */
  lift: number
  pose: TownsfolkPose
}

export interface TownsfolkPalette {
  readonly skin: number
  readonly tops: number
  readonly bottoms: number
}

export interface TownsfolkSimOptions {
  readonly venues: readonly TownsfolkVenue[]
  readonly seed: number
  readonly config: TownsfolkConfig
  readonly tier: AmbientTier
  /** How many colours each recoloured bucket has (ambient.json `pedestrians.palette`). */
  readonly palette: TownsfolkPalette
}

export interface TownsfolkSim {
  readonly residents: readonly Resident[]
  readonly samples: readonly TownsfolkSample[]
  /**
   * Writes every active local whose home is within `radiusM` of (x, y) (plus a walk) at city
   * time `tS` into `samples`, for locals `h` metres tall, and returns how many.
   */
  collect(x: number, y: number, radiusM: number, tS: number, h: number, share: number): number
  /** The place index a local is at (or leaving) in the cycle that holds `tS` (tests). */
  venueAt(resident: number, tS: number): number
}

/** A 32-bit FNV-1a hash of a string (place ids are strings). */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  }
  return hash
}

const pick = <T>(list: readonly T[], roll: number, fallback: T): T =>
  list[Math.min(list.length - 1, Math.floor(roll * list.length))] ?? fallback

/** The deterministic profile of slot `slot` of a place. */
export function townsfolkProfile(
  seed: number,
  venueId: string,
  slot: number,
  config: Pick<TownsfolkConfig, 'names' | 'vibes'>,
): { readonly profile: TownsfolkProfile; readonly hash: number; readonly rng: () => number } {
  const hash = hashInt(seed, hashString(venueId), slot, 0x70)
  const rng = createRng(hash)
  const next = () => rng.next()
  // Body first, so the card's name matches the model drawn.
  const body: TownsfolkBody = next() < 0.5 ? 'woman' : 'man'
  const first = pick(config.names[body], next(), '')
  const initial = pick([...config.names.initials], next(), '')
  const vibe = pick(config.vibes, next(), '')
  return {
    profile: {
      id: `${venueId}#${slot}`,
      name: initial === '' ? first : `${first} ${initial}.`,
      body,
      vibe,
      homeId: venueId,
    },
    hash,
    rng: next,
  }
}

/** Places sorted by distance from `from`, nearest first, within `maxM`, at most `count`. */
function nearest(
  venues: readonly TownsfolkVenue[],
  from: number,
  count: number,
  maxM: number,
): number[] {
  const a = venues[from]
  if (a === undefined || count === 0) return []
  return venues
    .map((b, i) => ({ i, d: Math.hypot(b.x - a.x, b.y - a.y) }))
    .filter((entry) => entry.i !== from && entry.d <= maxM)
    .sort((p, q) => p.d - q.d || p.i - q.i)
    .slice(0, count)
    .map((entry) => entry.i)
}

export function createTownsfolkSim(options: TownsfolkSimOptions): TownsfolkSim {
  const { venues, seed, config, tier, palette } = options
  const perVenue = config.perVenue[tier]
  const poses = config.poses[tier]
  const has = (pose: TownsfolkPose) => poses.includes(pose)
  const standing: TownsfolkPose = has('idle') ? 'idle' : (poses[0] ?? 'idle')
  const walking: TownsfolkPose = has('walk') ? 'walk' : standing
  const maxWalkM = config.walkSpeedMps * config.epochS * config.maxWalkShare
  const ringSlots = perVenue * 2

  const residents: Resident[] = []
  venues.forEach((venue, v) => {
    for (let slot = 0; slot < perVenue; slot++) {
      const { profile, hash, rng } = townsfolkProfile(seed, venue.id, slot, config)
      residents.push({
        profile,
        home: v,
        slot,
        hash,
        body: TOWNSFOLK_BODIES.indexOf(profile.body),
        skin: Math.floor(rng() * palette.skin),
        top: Math.floor(rng() * palette.tops),
        bottom: Math.floor(rng() * palette.bottoms),
        hair: Math.floor(rng() * config.hair.length),
      })
    }
  })
  const neighbours = venues.map((_, v) => nearest(venues, v, config.neighbours, maxWalkM))
  // Each place's ring turns by its own hash, so neighbouring rings do not look stamped.
  const ringTurn = venues.map((venue) => hash01(seed, hashString(venue.id), 0x71) * Math.PI * 2)

  const offsetOf = (r: Resident) => hash01(seed, r.hash, 0x72) * config.epochS
  const epochOf = (r: Resident, tS: number) => Math.floor((tS + offsetOf(r)) / config.epochS)

  const venueIn = (r: Resident, epoch: number): number => {
    const near = neighbours[r.home] ?? []
    if (near.length === 0 || hash01(seed, r.hash, epoch, 0x73) < config.homeShare) return r.home
    return near[hashInt(seed, r.hash, epoch, 0x74) % near.length] ?? r.home
  }

  /** The ring slot a local takes at a place: home slots are even, visitors take the odd gaps. */
  const slotAt = (r: Resident, venue: number) =>
    venue === r.home ? 2 * r.slot : 2 * (r.hash % perVenue) + 1

  const ringRadius = (h: number) =>
    Math.max(config.minRingOfHeight, (config.spacingOfHeight * ringSlots) / (2 * Math.PI)) * h

  const centreX = (venue: number) => venues[venue]?.x ?? 0
  const centreY = (venue: number) => (venues[venue]?.y ?? 0) - config.frontM

  const spot = { x: 0, y: 0 }
  const spotOf = (r: Resident, venue: number, h: number) => {
    const angle = ringTurn[venue] ?? 0
    const theta = angle + (slotAt(r, venue) / ringSlots) * Math.PI * 2
    const radius = ringRadius(h)
    spot.x = centreX(venue) + Math.sin(theta) * radius
    spot.y = centreY(venue) + Math.cos(theta) * radius
    return spot
  }

  const standingPose = (r: Resident, epoch: number, half: number): TownsfolkPose => {
    const roll = hash01(seed, r.hash, epoch * 2 + half, 0x75)
    if (has('talk') && roll < config.poseShare.talk) return 'talk'
    if (has('wave') && roll < config.poseShare.talk + config.poseShare.wave) return 'wave'
    return standing
  }

  const samples: TownsfolkSample[] = []

  const write = (out: TownsfolkSample, index: number, r: Resident, tS: number, h: number): void => {
    const shifted = tS + offsetOf(r)
    const epoch = Math.floor(shifted / config.epochS)
    const tau = shifted - epoch * config.epochS
    const from = venueIn(r, epoch)
    const to = venueIn(r, epoch + 1)
    const legM =
      from === to ? 0 : Math.hypot(centreX(to) - centreX(from), centreY(to) - centreY(from))
    const walkS = legM / config.walkSpeedMps
    const leaveS = config.epochS - walkS
    out.resident = index
    if (tau < leaveS || walkS === 0) {
      const at = spotOf(r, from, h)
      out.x = at.x
      out.y = at.y
      out.lift = 0
      out.pose = standingPose(r, epoch, tau < config.epochS / 2 ? 0 : 1)
      if (out.pose === 'talk') {
        // Facing the ring's centre: yaw = atan2(dx, -dy) turns the model's +z that way.
        out.yaw = Math.atan2(centreX(from) - at.x, -(centreY(from) - at.y))
      } else {
        // Facing the camera (south), a little turned each.
        out.yaw = (hash01(seed, r.hash, epoch, 0x76) * 2 - 1) * config.faceJitterRad
      }
      return
    }
    const u = (tau - leaveS) / walkS
    const a = spotOf(r, from, h)
    const ax = a.x
    const ay = a.y
    const b = spotOf(r, to, h)
    out.x = ax + (b.x - ax) * u
    out.y = ay + (b.y - ay) * u
    out.yaw = Math.atan2(b.x - ax, -(b.y - ay))
    out.pose = walking
    const stride = 2 * Math.PI * config.bobHz * (tau - leaveS) + hash01(seed, r.hash, 0x77) * 6
    out.lift = config.bobOfHeight * h * (0.5 + 0.5 * Math.cos(stride))
  }

  return {
    residents,
    samples,
    collect(x, y, radiusM, tS, h, share) {
      let n = 0
      const reach = radiusM + maxWalkM
      for (let i = 0; i < residents.length; i++) {
        const r = residents[i]
        const home = r === undefined ? undefined : venues[r.home]
        if (r === undefined || home === undefined) continue
        const dx = home.x - x
        const dy = home.y - y
        if (dx * dx + dy * dy > reach * reach) continue
        if (hash01(seed, r.hash, 0x78) >= share) continue
        let sample = samples[n]
        if (sample === undefined) {
          sample = { resident: 0, x: 0, y: 0, yaw: 0, lift: 0, pose: standing }
          samples.push(sample)
        }
        write(sample, i, r, tS, h)
        n++
      }
      return n
    },
    venueAt(resident, tS) {
      const r = residents[resident]
      return r === undefined ? -1 : venueIn(r, epochOf(r, tS))
    },
  }
}
