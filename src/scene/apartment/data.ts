/**
 * The apartment's data for its 3D chunk (S16): each home's interior (data/homes/interiors.json),
 * the scene's `apartment` block (data/config/scene.json), the room palette, decor colours and
 * the day/night keyframes the room's light follows (data/config/theme.json, scene.json
 * `dayNight`, S04f) and the per-tier budgets (data/config/perf.json). The files are
 * validated with their zod schemas in src/lib/data (data.test.ts, homes-data.test.ts); this chunk
 * reads the raw JSON so no config loader or classic zod ships to the browser, and narrows the
 * loosely typed JSON imports here, throwing at load on anything unexpected (fail fast).
 */
import finishesJson from '@data/homes/finishes.json'
import interiorsJson from '@data/homes/interiors.json'
import perfJson from '@data/config/perf.json'
import sceneJson from '@data/config/scene.json'
import themeJson from '@data/config/theme.json'
import { floorSlotId, isTurn, parseSlot, type GridWall, type Turn } from '@/engine/homeGrid'
import type { HomeIdLiteral } from '@/lib/data/homes'
import { resolveDayNight } from '@/lib/dayNight/resolveDayNight'
import type { DayNightModel, SceneDayNight, ThemeDayNight } from '@/lib/dayNight/types'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { SceneConfig } from '@/lib/data/schemas/scene'

export type Vec3 = readonly [number, number, number]
export type ApartmentConfig = SceneConfig['apartment']
export type RoomWall = GridWall

/** A window or door, in metres along its wall from the wall's middle (`centerM`). */
export interface RoomOpening {
  readonly kind: 'window' | 'door'
  readonly wall: RoomWall
  readonly centerM: number
  readonly widthM: number
  readonly heightM: number
  readonly sillM: number
}

/** A built-in piece: a catalog model (the kitchen's fridge and stove) or a counter cabinet. */
export type RoomFixture =
  | { readonly kind: 'model'; readonly model: string; readonly slotId: string; readonly turn: Turn }
  | { readonly kind: 'counter'; readonly slotId: string; readonly turn: Turn }

export interface RoomInterior {
  readonly grid: { readonly cols: number; readonly rows: number; readonly cellM: number }
  /** The room's box: the grid's extent and the ceiling height. */
  readonly room: { readonly widthM: number; readonly depthM: number; readonly heightM: number }
  readonly openings: readonly RoomOpening[]
  readonly camera: { readonly position: Vec3; readonly target: Vec3; readonly fovDeg: number }
  /** Where the player's avatar stands (S16a): its cell's centre, turned about the vertical axis. */
  readonly avatarAnchor: { readonly position: Vec3; readonly rotationDeg: number }
  readonly fixtures: readonly RoomFixture[]
  /** The finishes the home comes with, crown moulding, and a back-wall-only finish. */
  readonly shell: {
    readonly wallPaint: string
    readonly floorFinish: string
    readonly crown: boolean
    readonly accentBack: string | null
  }
}

/** The room's colours as hex, resolved from theme.json `scene.apartment` world tokens. */
export interface RoomPalette {
  readonly floor: string
  readonly wall: string
  readonly trim: string
  readonly furniture: string
  readonly plant: string
  readonly glow: string
  readonly window: string
  readonly marker: string
  readonly markerActive: string
  readonly markerSelected: string
  readonly markerRefused: string
  readonly blob: string
  /** Warm lamp light mixed into the ambient at night. */
  readonly lamp: string
  readonly cap: string
  readonly counter: string
  readonly countertop: string
  readonly curtain: string
}

const WALLS: readonly string[] = ['back', 'left', 'right']

function fail(what: string): never {
  throw new Error(`apartment data: ${what}`)
}

function vec3(value: readonly number[], what: string): Vec3 {
  const [x, y, z] = value
  if (value.length !== 3 || x === undefined || y === undefined || z === undefined) fail(what)
  return [x, y, z]
}

type RawInterior = (typeof interiorsJson.homes)[HomeIdLiteral]

function turnOf(value: number, what: string): Turn {
  return isTurn(value) ? value : fail(`${what} turn`)
}

function interior(home: HomeIdLiteral): RoomInterior {
  const raw: RawInterior = interiorsJson.homes[home]
  const { cols, rows, cellM } = raw.grid
  const size = { cols, rows }
  const room = { widthM: cols * cellM, depthM: rows * cellM, heightM: raw.heightM }
  const avatarSlot = parseSlot(raw.avatar.slot, size)
  if (avatarSlot?.kind !== 'floor') fail(`${home}.avatar.slot`)
  const slotOk = (slotId: string, what: string) =>
    parseSlot(slotId, size)?.kind === 'floor' ? slotId : fail(`${home}.${what}`)
  return {
    grid: raw.grid,
    room,
    openings: raw.openings.map((opening, i) => {
      if (!WALLS.includes(opening.wall)) fail(`${home}.openings[${i}].wall`)
      if (opening.kind !== 'window' && opening.kind !== 'door') fail(`${home}.openings[${i}]`)
      const wall = opening.wall as RoomWall
      const length = wall === 'back' ? room.widthM : room.depthM
      // A cell's share of wall less a frame's margin either side, centred on the cells it spans.
      const centerM = -length / 2 + (opening.at + opening.span / 2) * cellM
      return {
        kind: opening.kind,
        wall,
        centerM,
        widthM: opening.span * cellM - (opening.kind === 'door' ? 0.12 : 0.2),
        heightM: opening.heightM,
        sillM: opening.sillM,
      }
    }),
    camera: {
      position: vec3(raw.camera.position, `${home}.camera.position`),
      target: vec3(raw.camera.target, `${home}.camera.target`),
      fovDeg: raw.camera.fovDeg,
    },
    avatarAnchor: {
      position: [
        -room.widthM / 2 + (avatarSlot.c + 0.5) * cellM,
        0,
        -room.depthM / 2 + (avatarSlot.r + 0.5) * cellM,
      ],
      rotationDeg: raw.avatar.rotationDeg,
    },
    fixtures: raw.fixtures.map((fixture, i): RoomFixture => {
      const slotId = slotOk(fixture.slot, `fixtures[${i}]`)
      const turn = turnOf(fixture.turn, `${home}.fixtures[${i}]`)
      if (fixture.kind === 'counter') return { kind: 'counter', slotId, turn }
      const model = 'model' in fixture ? fixture.model : undefined
      if (fixture.kind !== 'model' || typeof model !== 'string') fail(`${home}.fixtures[${i}]`)
      return { kind: 'model', model, slotId, turn }
    }),
    shell: {
      wallPaint: raw.shell.wallPaint,
      floorFinish: raw.shell.floorFinish,
      crown: raw.shell.crown,
      accentBack: raw.shell.accentBack,
    },
  }
}

const INTERIORS: Readonly<Record<HomeIdLiteral, RoomInterior>> = {
  'queens-room': interior('queens-room'),
  'brooklyn-1br': interior('brooklyn-1br'),
  'manhattan-loft': interior('manhattan-loft'),
}

export function roomInterior(home: HomeIdLiteral): RoomInterior {
  return INTERIORS[home]
}

/** The centre of floor cell (c, r) in room metres. */
export function cellCenter(
  interior: RoomInterior,
  c: number,
  r: number,
): readonly [number, number] {
  const { cellM } = interior.grid
  return [
    -interior.room.widthM / 2 + (c + 0.5) * cellM,
    -interior.room.depthM / 2 + (r + 0.5) * cellM,
  ]
}

export { floorSlotId }

export const apartmentConfig: ApartmentConfig = sceneJson.apartment
/** What counts as a tap: the map's rule (src/scene/pins/tap.ts), shared so both feel the same. */
export const tapOptions = { slopPx: sceneJson.pins.tapSlopPx, maxMs: sceneJson.pins.tapMaxMs }
/** The toon ramp the whole game shares. */
export const toonRamp: readonly number[] = themeJson.scene.toonRamp

const colors: Readonly<Record<string, string>> = themeJson.colors
const worldColors: Readonly<Record<string, string>> = { ...themeJson.world, ...themeJson.models }

/** A decor colour token's hex (item variants name DOM palette tokens, theme.json `colors`). */
export function tokenHex(token: string): string {
  return colors[token] ?? fail(`unknown palette token "${token}"`)
}

/** A room colour token's hex (theme.json `world` or `models`). */
function worldHex(token: string): string {
  return worldColors[token] ?? fail(`unknown world token "${token}"`)
}

/**
 * The city's day/night model, resolved here like the rest of this chunk's data (resolveDayNight
 * checks ids, order and tokens, failing at load).
 */
export const dayNightModel: DayNightModel = resolveDayNight(
  sceneJson.dayNight as SceneDayNight,
  { colors: worldColors, sky: themeJson.sky } as ThemeDayNight,
)
export const dayNightConfig: { readonly room: SceneConfig['dayNight']['room'] } = {
  room: sceneJson.dayNight.room,
}

const refs = themeJson.scene.apartment

export const roomPalette: RoomPalette = {
  floor: worldHex(refs.floor),
  wall: worldHex(refs.wall),
  trim: worldHex(refs.trim),
  furniture: worldHex(refs.furniture),
  plant: worldHex(refs.plant),
  glow: worldHex(refs.glow),
  window: worldHex(refs.window),
  marker: worldHex(refs.marker),
  markerActive: worldHex(refs.markerActive),
  markerSelected: worldHex(refs.markerSelected),
  markerRefused: worldHex(refs.markerRefused),
  blob: worldHex(refs.blob),
  lamp: worldHex(refs.lamp),
  cap: worldHex(refs.cap),
  counter: worldHex(refs.counter),
  countertop: worldHex(refs.countertop),
  curtain: worldHex(refs.curtain),
}

const PATTERNS: readonly string[] = ['solid', 'checker', 'planks', 'herringbone', 'brick']

/** How a finish is drawn: its pattern and its colours as hex (the second repeats a solid). */
export interface FinishLook {
  readonly kind: 'wall' | 'floor'
  readonly pattern: 'solid' | 'checker' | 'planks' | 'herringbone' | 'brick'
  readonly colors: readonly [string, string]
}

const FINISHES: ReadonlyMap<string, FinishLook> = new Map(
  finishesJson.finishes.map((finish) => {
    if (!PATTERNS.includes(finish.pattern)) fail(`finish ${finish.id} pattern`)
    if (finish.kind !== 'wall' && finish.kind !== 'floor') fail(`finish ${finish.id} kind`)
    const [first, second] = finish.tokens.map(worldHex)
    if (first === undefined) fail(`finish ${finish.id} colours`)
    return [
      finish.id,
      {
        kind: finish.kind,
        pattern: finish.pattern as FinishLook['pattern'],
        colors: [first, second ?? first] as const,
      },
    ]
  }),
)

/** A finish's look; throws on an id the data does not have (fail fast). */
export function finishLook(finishId: string): FinishLook {
  return FINISHES.get(finishId) ?? fail(`unknown finish "${finishId}"`)
}

export interface TierBudget {
  readonly dprCap: number
  readonly shadows: 'none' | 'blob-or-baked' | 'pcf-directional'
  readonly drawCallsMax: number
  readonly trianglesMax: number
}

const SHADOW_MODES: readonly string[] = ['none', 'blob-or-baked', 'pcf-directional']

/** The apartment's render settings and caps for one quality tier (perf.json). */
export function tierBudget(tier: QualityTier): TierBudget {
  const shadows = perfJson.shadows[tier]
  if (!SHADOW_MODES.includes(shadows)) fail(`perf.shadows.${tier}`)
  return {
    dprCap: perfJson.dprCap[tier],
    shadows: shadows as TierBudget['shadows'],
    drawCallsMax: perfJson.apartment.drawCallsMax[tier],
    trianglesMax: perfJson.apartment.trianglesMax[tier],
  }
}

/** Kept free inside every tier's caps for the 3D avatar in the room (S16a). */
export const avatarReserve: { readonly drawCalls: number; readonly triangles: number } =
  perfJson.apartment.avatarReserve
