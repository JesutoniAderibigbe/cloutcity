/**
 * A venue interior's data for its lazy chunk (S43): data/interiors/venues/<id>.json (each
 * interior's layout, pieces, lights, crowd spots and the Sim's actions), data/interiors/sim.json
 * (the poses and props every interior adds to the room Sim), data/config/interiors.json (the
 * per-tier caps and crowd) and the shared apartment data it builds on (the room shell config,
 * finishes, palette and day/night model, src/scene/apartment/data.ts). The files are validated
 * with their zod schemas in src/lib/data/interiors-data.test.ts; this chunk reads the raw JSON
 * and narrows it here, throwing at load on anything unexpected (fail fast), so classic zod never
 * ships to the browser.
 *
 * Each interior's file is its own small lazy chunk (S43b, `INTERIOR_LOADERS`), fetched when the
 * player steps inside: `loadVenueInterior` first, then the synchronous readers below.
 *
 * An interior is turned into the apartment's own `RoomInterior`, so the room shell, the orbit
 * camera, the furniture models and the room Sim all work on it unchanged.
 */
import interiorsConfigJson from '@data/config/interiors.json'
import perfJson from '@data/config/perf.json'
import sceneJson from '@data/config/scene.json'
import themeJson from '@data/config/theme.json'
import simJson from '@data/interiors/sim.json'
import type clubJson from '@data/interiors/venues/club.json'
import type loungeJson from '@data/interiors/venues/lounge.json'
import { isTurn, parseSlot, type GridFootprint, type Turn } from '@/engine/homeGrid'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CrowdPalette, CrowdSpot } from '@/lib/world/venueCrowd'
import { finishLook, type RoomInterior, type RoomOpening, type Vec3 } from '../apartment/data'
import { placeAnchor, buildWorld, type SimWorld } from '../apartment/sim/simWorld'
import {
  simData,
  simStep,
  type SimAnchor,
  type SimData,
  type SimPose,
  type PropPart,
} from '../apartment/sim/simData'
import type { ApartmentPlacement } from '../apartment/types'

/** An interior file's raw JSON (every file has the same shape; these two cover its variants). */
type Raw = typeof clubJson | typeof loungeJson
type RawPart = Raw['build'][number]

export type Glow = 'steady' | 'beat' | 'night'

/** A code-built part in room metres, its colour as hex. */
export interface BuiltPart {
  readonly shape: 'box' | 'disc'
  readonly size: Vec3
  readonly at: Vec3
  /** Turn about the vertical (a piece's quarter turns). */
  readonly yaw: number
  readonly color: string
  readonly glow: Glow | null
  /** Index among its piece's copies (the glow's colour cycle and ripple). */
  readonly index: number
  /** The colours a `beat` part cycles through. */
  readonly cycle: readonly string[]
}

export interface DanceFloor {
  readonly x0: number
  readonly z0: number
  readonly cols: number
  readonly rows: number
  readonly tileM: number
  readonly liftM: number
  readonly gapShare: number
  readonly colors: readonly string[]
  readonly dim: string
}

export interface PartyLights {
  readonly heads: readonly Vec3[]
  readonly aim: Vec3
  readonly beamLengthM: number
  readonly beamRadiusM: number
  readonly beamOpacity: number
  readonly swingRad: number
  readonly colors: readonly string[]
  readonly ball: { readonly at: Vec3; readonly radiusM: number; readonly color: string } | null
}

export interface StringLights {
  readonly poles: readonly (readonly [number, number])[]
  readonly strands: readonly (readonly [number, number])[]
  readonly topM: number
  readonly sagM: number
  readonly bulbSpacingM: number
  readonly bulbM: number
  readonly wire: string
  readonly bulb: string
  readonly bulbDay: string
}

export interface Skyline {
  readonly seed: number
  readonly count: number
  readonly sides: readonly ('back' | 'left' | 'right')[]
  readonly gapM: readonly [number, number]
  readonly heightM: readonly [number, number]
  readonly widthM: readonly [number, number]
  readonly baseM: number
  readonly colors: readonly string[]
  readonly cap: string
  readonly window: string
  readonly windowDay: string
  readonly windowRows: number
  readonly windowCols: number
}

export interface VenueMood {
  readonly music: string
  readonly bpm: number
  readonly tint: string
  readonly openMix: number
  readonly openAmbientScale: number
  readonly openSunScale: number
  readonly closedAmbientScale: number
}

export interface VenueInterior {
  readonly id: string
  /** The interior as the apartment's room: shell, orbit and furniture code read this. */
  readonly room: RoomInterior
  /** The catalog furniture, as the apartment's placements (keyed by decor id). */
  readonly placed: Readonly<Record<string, ApartmentPlacement>>
  /** Decor id → the catalog item whose look it takes. */
  readonly itemOf: ReadonlyMap<string, string>
  readonly parts: readonly BuiltPart[]
  readonly danceFloor: DanceFloor | null
  readonly partyLights: PartyLights | null
  readonly stringLights: StringLights | null
  readonly skyline: Skyline | null
  readonly mood: VenueMood
  readonly backdrop: { readonly kind: 'room' | 'sky'; readonly tint: string | null }
  /** What the Sim walks around and sits on. */
  readonly world: SimWorld
  /** The locals' spots: the listed ones and the seats of the listed kinds and models. */
  readonly crowdSpots: readonly CrowdSpot[]
  readonly crowd: {
    readonly hours: readonly (readonly [number, number])[]
    readonly busyDays: readonly number[]
    readonly quietShare: number
  }
}

const DEG = Math.PI / 180
const QUARTER = Math.PI / 2

function fail(what: string): never {
  throw new Error(`venue interior data: ${what}`)
}

const colorMaps: readonly Readonly<Record<string, string>>[] = [
  themeJson.colors,
  themeJson.world,
  themeJson.models,
]

/** A palette token's hex (theme.json `colors`, `world` or `models`); throws on an unknown one. */
export function venueHex(token: string): string {
  for (const map of colorMaps) {
    const hex = map[token]
    if (hex !== undefined) return hex
  }
  return fail(`unknown palette token "${token}"`)
}

function vec3(value: readonly number[], what: string): Vec3 {
  const [x, y, z] = value
  if (value.length !== 3 || x === undefined || y === undefined || z === undefined) fail(what)
  return [x, y, z]
}

function pair(value: readonly number[], what: string): readonly [number, number] {
  const [a, b] = value
  if (value.length !== 2 || a === undefined || b === undefined) fail(what)
  return [a, b]
}

function turnOf(value: number, what: string): Turn {
  return isTurn(value) ? value : fail(`${what} turn`)
}

function footprintOf(value: string, what: string): GridFootprint {
  return value === '1x1' || value === '2x1' || value === '2x2' ? value : fail(`${what} footprint`)
}

function glowOf(value: string | undefined, what: string): Glow | null {
  if (value === undefined) return null
  return value === 'steady' || value === 'beat' || value === 'night' ? value : fail(`${what} glow`)
}

const WALLS: readonly string[] = ['back', 'left', 'right']

/** `[x, z]` turned `turn` quarter turns about the vertical (the room Sim's item frame). */
function turned(x: number, z: number, turn: Turn): readonly [number, number] {
  const angle = turn * QUARTER
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

/** Every copy of a part (its `repeat` and `rows`), moved by `origin` and turned by `turn`. */
function expandPart(
  raw: RawPart,
  what: string,
  origin: readonly [number, number, number],
  turn: Turn,
): BuiltPart[] {
  const shape = raw.shape === 'box' || raw.shape === 'disc' ? raw.shape : fail(`${what}.shape`)
  const size = vec3(raw.size, `${what}.size`)
  const at = vec3(raw.at, `${what}.at`)
  const glow = glowOf('glow' in raw ? raw.glow : undefined, what)
  const repeat =
    'repeat' in raw && raw.repeat !== undefined ? raw.repeat : { count: 1, step: [0, 0, 0] }
  const rows = 'rows' in raw && raw.rows !== undefined ? raw.rows : { count: 1, step: [0, 0, 0] }
  const tokens = 'tokens' in raw && raw.tokens !== undefined ? raw.tokens : [raw.token]
  const cycle = tokens.map(venueHex)
  const step = vec3(repeat.step, `${what}.repeat`)
  const rowStep = vec3(rows.step, `${what}.rows`)
  const parts: BuiltPart[] = []
  for (let j = 0; j < rows.count; j++) {
    for (let i = 0; i < repeat.count; i++) {
      const index = j * repeat.count + i
      const lx = at[0] + step[0] * i + rowStep[0] * j
      const ly = at[1] + step[1] * i + rowStep[1] * j
      const lz = at[2] + step[2] * i + rowStep[2] * j
      const [dx, dz] = turned(lx, lz, turn)
      parts.push({
        shape,
        size,
        at: [origin[0] + dx, origin[1] + ly, origin[2] + dz],
        yaw: turn * QUARTER,
        color: cycle[index % cycle.length] ?? venueHex(raw.token),
        glow,
        index,
        cycle: glow === 'beat' ? cycle : [],
      })
    }
  }
  return parts
}

/** The SimWorld's model for each catalog decor item (scene.json `models.decor`). */
const decorModel: Readonly<Record<string, { readonly model: string } | undefined>> =
  sceneJson.models.decor

function cellCentre(room: RoomInterior, slot: string, what: string): readonly [number, number] {
  const parsed = parseSlot(slot, room.grid)
  if (parsed?.kind !== 'floor') fail(`${what} slot ${slot}`)
  const { cellM } = room.grid
  return [
    -room.room.widthM / 2 + (parsed.c + 0.5) * cellM,
    -room.room.depthM / 2 + (parsed.r + 0.5) * cellM,
  ]
}

function load(id: string, raw: Raw): VenueInterior {
  const { cols, rows, cellM } = raw.grid
  const room = { widthM: cols * cellM, depthM: rows * cellM, heightM: raw.heightM }
  const size = { cols, rows }
  const floorSlot = (slot: string, what: string) =>
    parseSlot(slot, size)?.kind === 'floor' ? slot : fail(`${id}.${what} ${slot}`)
  // Every finish must exist (finishLook throws on an unknown id).
  for (const finish of [raw.shell.wallPaint, raw.shell.floorFinish]) finishLook(finish)
  const entry = parseSlot(floorSlot(raw.entry.slot, 'entry'), size)
  if (entry?.kind !== 'floor') fail(`${id}.entry`)
  const openings: RoomOpening[] = raw.openings.map((opening, i) => {
    if (!WALLS.includes(opening.wall)) fail(`${id}.openings[${i}].wall`)
    if (opening.kind !== 'window' && opening.kind !== 'door') fail(`${id}.openings[${i}]`)
    const wall = opening.wall as RoomOpening['wall']
    const length = wall === 'back' ? room.widthM : room.depthM
    return {
      kind: opening.kind,
      wall,
      centerM: -length / 2 + (opening.at + opening.span / 2) * cellM,
      widthM: opening.span * cellM - (opening.kind === 'door' ? 0.12 : 0.2),
      heightM: opening.heightM,
      sillM: opening.sillM,
    }
  })
  const interior: RoomInterior = {
    grid: raw.grid,
    room,
    openings,
    camera: {
      position: vec3(raw.camera.position, `${id}.camera.position`),
      target: vec3(raw.camera.target, `${id}.camera.target`),
      fovDeg: raw.camera.fovDeg,
    },
    avatarAnchor: {
      position: [
        -room.widthM / 2 + (entry.c + 0.5) * cellM,
        0,
        -room.depthM / 2 + (entry.r + 0.5) * cellM,
      ],
      rotationDeg: raw.entry.rotationDeg,
    },
    fixtures: raw.fixtures.map((fixture, i) => ({
      kind: 'model' as const,
      model: fixture.model,
      slotId: floorSlot(fixture.slot, `fixtures[${i}]`),
      turn: turnOf(fixture.turn, `${id}.fixtures[${i}]`),
    })),
    shell: {
      wallPaint: raw.shell.wallPaint,
      floorFinish: raw.shell.floorFinish,
      crown: raw.shell.crown,
      accentBack: raw.shell.accentBack,
    },
  }

  const placed: Record<string, ApartmentPlacement> = {}
  const itemOf = new Map<string, string>()
  raw.decor.forEach((decor, i) => {
    placed[decor.id] = {
      itemId: decor.id,
      slotId: floorSlot(decor.slot, `decor[${i}]`),
      turn: turnOf(decor.turn, `${id}.decor[${i}]`),
      token: decor.token,
      mount: 'floor',
      footprint: footprintOf(decor.footprint, `${id}.decor[${i}]`),
    }
    itemOf.set(decor.id, decor.item)
  })

  const kinds = raw.kinds as Readonly<
    Record<string, { parts: readonly RawPart[]; anchors: readonly unknown[] } | undefined>
  >
  const parts: BuiltPart[] = raw.build.flatMap((part, i) =>
    expandPart(part, `${id}.build[${i}]`, [0, 0, 0], 0),
  )
  const pieces = raw.pieces.map((piece, i) => {
    const kind = kinds[piece.kind] ?? fail(`${id}.pieces[${i}] kind ${piece.kind}`)
    const turn = turnOf(piece.turn, `${id}.pieces[${i}]`)
    const [cx, cz] = cellCentre(interior, piece.slot, `${id}.pieces[${i}]`)
    const offset = 'offset' in piece && piece.offset !== undefined ? piece.offset : [0, 0, 0]
    const [ox, oy, oz] = vec3(offset, `${id}.pieces[${i}].offset`)
    kind.parts.forEach((part, p) => {
      parts.push(
        ...expandPart(part, `${id}.kinds.${piece.kind}[${p}]`, [cx + ox, oy, cz + oz], turn),
      )
    })
    return { kind: piece.kind, slotId: piece.slot, turn }
  })

  const world = buildWorld({
    grid: raw.grid,
    fixtures: [
      ...raw.blocked.map((slot) => ({
        kind: 'counter' as const,
        slotId: floorSlot(slot, 'blocked'),
        turn: 0 as const,
      })),
      ...pieces.map((piece) => ({
        kind: 'model' as const,
        model: piece.kind,
        slotId: piece.slotId,
        turn: piece.turn,
      })),
      ...interior.fixtures.map((fixture) => ({
        kind: 'model' as const,
        model: fixture.kind === 'model' ? fixture.model : undefined,
        slotId: fixture.slotId,
        turn: fixture.turn,
      })),
    ],
    placed: Object.values(placed),
    modelOf: (decorId) => decorModel[itemOf.get(decorId) ?? '']?.model ?? null,
    walkable: simData.walkable,
  })

  const anchors = venueAnchors(raw)
  const crowdSpots: CrowdSpot[] = raw.crowd.spots.map((spot, i) => {
    const [x, z] = pair(spot.at, `${id}.crowd.spots[${i}].at`)
    return {
      id: `spot-${i}`,
      activity: spot.activity,
      pose: spot.pose,
      x,
      y: 0,
      z,
      headingRad: spot.headingDeg * DEG,
      rank: spot.rank,
      staff: 'staff' in spot && spot.staff === true,
    }
  })
  raw.crowd.seats.forEach((seat, s) => {
    const model =
      ('kind' in seat ? seat.kind : undefined) ?? ('model' in seat ? seat.model : undefined)
    if (model === undefined) fail(`${id}.crowd.seats[${s}]`)
    for (const item of world.items) {
      if (item.model !== model) continue
      const list = (anchors.get(model) ?? []).filter((anchor) => anchor.pose === 'sit')
      list.forEach((anchor, a) => {
        const placedAnchor = placeAnchor(item, anchor)
        crowdSpots.push({
          id: `seat-${item.id}-${a}`,
          activity: seat.activity,
          pose: 'sit',
          x: placedAnchor.at[0],
          y: placedAnchor.at[1],
          z: placedAnchor.at[2],
          headingRad: placedAnchor.headingRad,
          rank: seat.rank,
          staff: false,
        })
      })
    }
  })

  const floor = raw.danceFloor
  const lights = raw.partyLights
  const strings = raw.stringLights
  const skyline = raw.skyline
  return {
    id,
    room: interior,
    placed,
    itemOf,
    parts,
    danceFloor:
      floor === null
        ? null
        : (() => {
            const [x, z] = cellCentre(interior, floor.slot, `${id}.danceFloor`)
            return {
              x0: x - cellM / 2,
              z0: z - cellM / 2,
              cols: floor.cols * floor.tilesPerCell,
              rows: floor.rows * floor.tilesPerCell,
              tileM: cellM / floor.tilesPerCell,
              liftM: floor.liftM,
              gapShare: floor.gapShare,
              colors: floor.tokens.map(venueHex),
              dim: venueHex(floor.dim),
            }
          })(),
    partyLights:
      lights === null
        ? null
        : {
            heads: lights.heads.map((head, i) => vec3(head, `${id}.partyLights.heads[${i}]`)),
            aim: vec3(lights.aim, `${id}.partyLights.aim`),
            beamLengthM: lights.beamLengthM,
            beamRadiusM: lights.beamRadiusM,
            beamOpacity: lights.beamOpacity,
            swingRad: lights.swingDeg * DEG,
            colors: lights.tokens.map(venueHex),
            ball:
              lights.ball === null
                ? null
                : {
                    at: vec3(lights.ball.at, `${id}.partyLights.ball`),
                    radiusM: lights.ball.radiusM,
                    color: venueHex(lights.ball.token),
                  },
          },
    stringLights:
      strings === null
        ? null
        : {
            poles: strings.poles.map((pole, i) => pair(pole, `${id}.stringLights.poles[${i}]`)),
            strands: strings.strands.map((strand, i) =>
              pair(strand, `${id}.stringLights.strands[${i}]`),
            ),
            topM: strings.topM,
            sagM: strings.sagM,
            bulbSpacingM: strings.bulbSpacingM,
            bulbM: strings.bulbM,
            wire: venueHex(strings.wireToken),
            bulb: venueHex(strings.bulbToken),
            bulbDay: venueHex(strings.dayToken),
          },
    skyline:
      skyline === null
        ? null
        : {
            seed: skyline.seed,
            count: skyline.count,
            sides: skyline.sides.map((side) =>
              side === 'back' || side === 'left' || side === 'right'
                ? side
                : fail(`${id}.skyline side ${side}`),
            ),
            gapM: pair(skyline.gapM, `${id}.skyline.gapM`),
            heightM: pair(skyline.heightM, `${id}.skyline.heightM`),
            widthM: pair(skyline.widthM, `${id}.skyline.widthM`),
            baseM: skyline.baseM,
            colors: skyline.tokens.map(venueHex),
            cap: venueHex(skyline.capToken),
            window: venueHex(skyline.windowToken),
            windowDay: venueHex(skyline.windowDayToken),
            windowRows: skyline.windowRows,
            windowCols: skyline.windowCols,
          },
    mood: {
      music: raw.mood.music,
      bpm: raw.mood.bpm,
      tint: venueHex(raw.mood.tint),
      openMix: raw.mood.openMix,
      openAmbientScale: raw.mood.openAmbientScale,
      openSunScale: raw.mood.openSunScale,
      closedAmbientScale: raw.mood.closedAmbientScale,
    },
    backdrop: {
      kind:
        raw.backdrop.kind === 'room' || raw.backdrop.kind === 'sky'
          ? raw.backdrop.kind
          : fail(`${id}.backdrop`),
      tint: raw.backdrop.tint === null ? null : venueHex(raw.backdrop.tint),
    },
    world,
    crowdSpots,
    crowd: {
      hours: raw.crowd.hours.map((hour, i) => pair(hour, `${id}.crowd.hours[${i}]`)),
      busyDays: raw.crowd.busyDays,
      quietShare: raw.crowd.quietShare,
    },
  }
}

/** The room Sim's anchors plus the interior's piece kinds' (a stool's seat). */
function venueAnchors(raw: Raw): ReadonlyMap<string, readonly SimAnchor[]> {
  const anchors = new Map(simData.anchors)
  for (const [kind, entry] of Object.entries(raw.kinds) as [
    string,
    {
      anchors: readonly { pose: string; at: number[]; headingDeg: number; approach: number[][] }[]
    },
  ][]) {
    if (entry.anchors.length === 0) continue
    anchors.set(
      kind,
      entry.anchors.map((anchor, i) => ({
        pose: anchor.pose,
        at: vec3(anchor.at, `kinds.${kind}.anchors[${i}].at`),
        headingRad: anchor.headingDeg * DEG,
        approach: anchor.approach.map((point, j) =>
          vec3(point, `kinds.${kind}.anchors[${i}].approach[${j}]`),
        ),
        prop: null,
      })),
    )
  }
  return anchors
}

/**
 * Each interior's file, as its own lazy chunk: the bundler splits every `import()` here, so an
 * interior's data is only fetched when a player steps inside it (never in the shell, never
 * precached: src/lib/pwa/lazyChunks.ts `venue-interior-data`).
 */
const INTERIOR_LOADERS: Readonly<Record<string, () => Promise<{ default: unknown }>>> = {
  club: () => import('@data/interiors/venues/club.json'),
  lounge: () => import('@data/interiors/venues/lounge.json'),
  // S43b: food
  'food-spot': () => import('@data/interiors/venues/food-spot.json'),
  coffee: () => import('@data/interiors/venues/coffee.json'),
  'food-cart': () => import('@data/interiors/venues/food-cart.json'),
  bodega: () => import('@data/interiors/venues/bodega.json'),
  // S43b: looks
  barber: () => import('@data/interiors/venues/barber.json'),
  salon: () => import('@data/interiors/venues/salon.json'),
  boutique: () => import('@data/interiors/venues/boutique.json'),
  thrift: () => import('@data/interiors/venues/thrift.json'),
  // S43b: fitness and fun
  gym: () => import('@data/interiors/venues/gym.json'),
  boxing: () => import('@data/interiors/venues/boxing.json'),
  park: () => import('@data/interiors/venues/park.json'),
  studio: () => import('@data/interiors/venues/studio.json'),
  // S43b: work and everyday
  'job-site': () => import('@data/interiors/venues/job-site.json'),
  warehouse: () => import('@data/interiors/venues/warehouse.json'),
  depot: () => import('@data/interiors/venues/depot.json'),
  mall: () => import('@data/interiors/venues/mall.json'),
  bank: () => import('@data/interiors/venues/bank.json'),
  pharmacy: () => import('@data/interiors/venues/pharmacy.json'),
  laundromat: () => import('@data/interiors/venues/laundromat.json'),
  community: () => import('@data/interiors/venues/community.json'),
  station: () => import('@data/interiors/venues/station.json'),
}

/** Every interior id with a data file. */
export const VENUE_INTERIOR_IDS: readonly string[] = Object.keys(INTERIOR_LOADERS)

const rawInteriors = new Map<string, Raw>()
const loading = new Map<string, Promise<void>>()

/**
 * Fetches interior `id`'s data (once: the same promise until it fails, so React's `use` can wait
 * on it); rejects on an unknown id or a failed fetch (offline before it was cached).
 */
export function loadVenueInterior(id: string): Promise<void> {
  let pending = loading.get(id)
  if (pending === undefined) {
    const loader = INTERIOR_LOADERS[id]
    pending =
      loader === undefined
        ? Promise.reject(new Error(`venue interior data: unknown interior "${id}"`))
        : loader().then((module) => {
            rawInteriors.set(id, module.default as Raw)
          })
    loading.set(id, pending)
    // A failed fetch can be retried on the next visit.
    pending.catch(() => loading.delete(id))
  }
  return pending
}

function rawInterior(id: string): Raw {
  return rawInteriors.get(id) ?? fail(`interior "${id}" is not loaded (loadVenueInterior first)`)
}

const cache = new Map<string, VenueInterior>()

/** A loaded interior by id (`loadVenueInterior` first); throws on one not loaded (fail fast). */
export function venueInterior(id: string): VenueInterior {
  let interior = cache.get(id)
  if (interior === undefined) {
    interior = load(id, rawInterior(id))
    cache.set(id, interior)
  }
  return interior
}

const venueSim = simJson.sim

/** The room Sim's data with an interior's poses, props, anchors, actions and spots added. */
export function venueSimData(id: string): SimData {
  const raw = rawInterior(id)
  const poses = new Map<string, SimPose>(simData.poses)
  for (const [pose, entry] of Object.entries(venueSim.poses)) {
    poses.set(pose, {
      clip: entry.clip,
      contact: vec3(entry.contactRigUnits, `sim.poses.${pose}`),
      tiltRad: entry.tiltDeg * DEG,
    })
  }
  const props = new Map<string, readonly PropPart[]>(simData.props)
  for (const [prop, entry] of Object.entries(venueSim.props)) {
    props.set(
      prop,
      entry.parts.map((part, i) => ({
        shape: part.shape === 'box' || part.shape === 'disc' ? part.shape : fail(`props.${prop}`),
        size: vec3(part.size, `sim.props.${prop}[${i}].size`),
        at: vec3(part.at, `sim.props.${prop}[${i}].at`),
        token: part.token,
      })),
    )
  }
  const hands = new Map(simData.hands)
  for (const [pose, at] of Object.entries(venueSim.hands))
    hands.set(pose, vec3(at, `hands.${pose}`))
  const actions = new Map(
    Object.entries(raw.actions as Readonly<Record<string, readonly unknown[]>>).map(
      ([action, steps]) => [
        action,
        (steps as Parameters<typeof simStep>[0][]).map((step, i) =>
          simStep(step, `${id}.actions.${action}[${i}]`),
        ),
      ],
    ),
  )
  for (const [action, steps] of actions) {
    for (const step of steps) {
      for (const pose of step.poses) if (!poses.has(pose)) fail(`${id}.actions.${action} ${pose}`)
      if (step.prop !== null && !props.has(step.prop)) fail(`${id}.actions.${action} prop`)
    }
  }
  return {
    ...simData,
    poses,
    props,
    hands,
    actions,
    anchors: venueAnchors(raw),
    spots: {
      [id]: raw.simSpots.map((spot) => ({
        pose: poses.has(spot.pose) ? spot.pose : fail(`${id}.simSpots ${spot.pose}`),
        slot: spot.slot,
        headingRad: spot.rotationDeg * DEG,
        heightM: spot.heightM,
      })),
    },
  }
}

/** The player's dance (SimAvatar `groove`) at an interior's beat. */
export function venueGroove(bpm: number) {
  return { ...venueSim.groove, bpm }
}

export interface VenueBudget {
  readonly dprCap: number
  readonly shadows: 'none' | 'blob-or-baked' | 'pcf-directional'
  readonly drawCallsMax: number
  readonly trianglesMax: number
}

const SHADOW_MODES: readonly string[] = ['none', 'blob-or-baked', 'pcf-directional']

/** An interior's render settings (perf.json) and caps (data/config/interiors.json) for a tier. */
export function venueBudget(tier: QualityTier): VenueBudget {
  const shadows = perfJson.shadows[tier]
  if (!SHADOW_MODES.includes(shadows)) fail(`perf.shadows.${tier}`)
  return {
    dprCap: perfJson.dprCap[tier],
    shadows: shadows as VenueBudget['shadows'],
    drawCallsMax: interiorsConfigJson.caps.drawCallsMax[tier],
    trianglesMax: interiorsConfigJson.caps.trianglesMax[tier],
  }
}

export const occupantReserve: { readonly drawCalls: number; readonly triangles: number } =
  interiorsConfigJson.caps.occupantReserve

export type CrowdClip = 'idle' | 'talk' | 'wave' | 'walk' | 'sit' | 'interact' | 'run'
const CROWD_CLIPS: readonly string[] = ['idle', 'talk', 'wave', 'walk', 'sit', 'interact', 'run']

/** A pose's movement over its loop: the dance's groove, a rep's bob, a boxer's bounce. */
export interface CrowdMove {
  readonly bobM: number
  readonly swayRad: number
  /** Bobs per beat. */
  readonly perBeat: number
}

/**
 * The locals' config for a tier in interior `id` (data/config/interiors.json `crowd`): the poses
 * drawn are the interior's first poses (`crowd.poses`) whose clips fit the tier's `clipsMax`.
 */
export function crowdConfig(tier: QualityTier, id: string) {
  const crowd = interiorsConfigJson.crowd
  const clips = crowd.clips as Readonly<Record<string, string | undefined>>
  const clipOf = (pose: string): CrowdClip => {
    const clip = clips[pose]
    return clip !== undefined && CROWD_CLIPS.includes(clip)
      ? (clip as CrowdClip)
      : fail(`crowd.clips.${pose}`)
  }
  const baked = new Set<CrowdClip>()
  const poses = new Set<string>()
  for (const pose of rawInterior(id).crowd.poses) {
    const clip = clipOf(pose)
    if (!baked.has(clip)) {
      if (baked.size >= crowd.clipsMax[tier]) continue
      baked.add(clip)
    }
    poses.add(pose)
  }
  const bodies = crowd.bodies[tier]
  if (bodies !== 1 && bodies !== 2) fail(`crowd.bodies.${tier}`)
  const moves = new Map<string, CrowdMove>([
    ['dance', { bobM: crowd.groove.bobM, swayRad: crowd.groove.swayDeg * DEG, perBeat: 1 }],
  ])
  for (const [pose, move] of Object.entries(crowd.moves)) {
    moves.set(pose, { bobM: move.bobM, swayRad: move.swayDeg * DEG, perBeat: move.perBeat })
  }
  return {
    max: crowd.max[tier],
    bodies,
    poses,
    /** The clips the tier bakes for this interior. */
    clips: [...baked],
    clipOf,
    frames: crowd.frames[tier],
    heightM: crowd.heightM,
    sit: crowd.sit,
    jitterM: crowd.jitterM,
    headingJitterRad: crowd.headingJitterDeg * DEG,
    groove: { ...crowd.groove, swayRad: crowd.groove.swayDeg * DEG },
    dance: {
      moves: crowd.dance.moves[tier],
      frames: crowd.dance.frames[tier],
      swayRad: crowd.dance.swayDeg * DEG,
    },
    moves,
    palette: crowd.palette as CrowdPalette,
  }
}

export const occupantsMax = (tier: QualityTier): number => interiorsConfigJson.occupants.max[tier]

export const lightsConfig = (tier: QualityTier) => ({
  beams: interiorsConfigJson.lights.beams[tier],
  tileBeats: interiorsConfigJson.lights.tileBeats,
  panelBeats: interiorsConfigJson.lights.panelBeats,
  closedGlow: interiorsConfigJson.lights.closedGlow,
})
