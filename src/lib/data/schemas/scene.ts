/**
 * Schema for data/config/scene.json: the 3D city's camera rig, layer heights and render sizes.
 * Distances are metres (1 scene unit = 1 m), angles degrees, widths CSS pixels. Colours are not
 * here: they are palette tokens in data/config/theme.json (`scene`).
 */
import { z } from 'zod'
import { QualityTierSchema, STREET_PROP_MODELS } from './config'
import { VehicleKitConfigSchema } from './ambientKit'
import { LandmarkSceneConfigSchema } from './landmarkModels'
import { MAP_STYLES } from '@/lib/world/mapStyleIds'

const HEX = z.string().regex(/^#[0-9a-f]{6}$/i)
const VEC3 = z.tuple([z.number(), z.number(), z.number()])

const metres = z.number().positive()
const ratio = z.number().positive()

/** A default angle and the range the player may move it within. */
const AngleRangeSchema = z
  .strictObject({ default: z.number(), min: z.number(), max: z.number() })
  .refine((angle) => angle.min <= angle.default && angle.default <= angle.max, {
    error: 'default must lie within min..max',
  })

const KEYFRAME_IDS = ['dawn', 'morning', 'day', 'golden', 'dusk', 'night'] as const
const unit = z.number().min(0).max(1)

/** One keyframe of the day (src/lib/dayNight/types.ts `SceneKeyframe`). */
const DayNightKeyframeSchema = z.strictObject({
  id: z.enum(KEYFRAME_IDS),
  /** Game minute of day the keyframe is reached. */
  atMinute: z.int().min(0).max(1439),
  /** Minutes it stays fully on before blending towards the next keyframe. */
  holdMinutes: z.int().nonnegative(),
  /** The interface palette from this keyframe on (S04g). */
  ui: z.enum(['day', 'night']),
  /** Azimuth clockwise from north, elevation above the horizon (clamped to minSunElevationDeg). */
  sun: z.strictObject({ azimuthDeg: z.number(), elevationDeg: z.number().min(-90).max(90) }),
  sunIntensity: z.number().nonnegative(),
  /** LightShadow.intensity: the shadow fades at night instead of being switched off. */
  shadowIntensity: unit,
  ambientIntensity: z.number().nonnegative(),
  hemisphereIntensity: z.number().nonnegative(),
  /** Lit windows and landmark glow, 0 by day to 1 at night (the shared uNightGlow uniform). */
  nightGlow: unit,
})

export const DayNightConfigSchema = z
  .strictObject({
    /** Lighting changes in steps of this many game minutes (must divide 1440). */
    quantizeMinutes: z.int().positive(),
    minSunElevationDeg: z.number().min(0).lt(90),
    /** Shown until the HUD has read the save (a new game starts at 08:00). */
    unknownMinute: z.int().min(0).max(1439),
    /** Fog near and far, as multiples of the camera distance. */
    fog: z.strictObject({ nearPerDistance: ratio, farPerDistance: ratio }),
    /**
     * The apartment (S16): the city keyframe's sun and ambient scaled for indoors, and the share
     * of warm lamp light mixed into the ambient colour at full night glow.
     */
    room: z.strictObject({
      sunScale: ratio,
      ambientScale: ratio,
      lampMix: unit,
      /** Ambient intensity the lamps add at full night (S40): the room stays lived-in after dark. */
      lampBoost: z.number().nonnegative(),
    }),
    /** Every keyframe once, in clock order. */
    keyframes: z.array(DayNightKeyframeSchema).length(KEYFRAME_IDS.length),
  })
  .refine((d) => 1440 % d.quantizeMinutes === 0, {
    error: 'quantizeMinutes must divide a day of 1440 minutes',
    path: ['quantizeMinutes'],
  })
  .refine((d) => d.fog.nearPerDistance < d.fog.farPerDistance, {
    error: 'fog must start before it ends',
    path: ['fog'],
  })
  .refine((d) => d.keyframes.every((k, i) => k.id === KEYFRAME_IDS[i]), {
    error: `keyframes must be ${KEYFRAME_IDS.join(', ')}, in that order`,
    path: ['keyframes'],
  })
  .refine(
    (d) =>
      d.keyframes.every((k, i) => {
        const next = d.keyframes[(i + 1) % d.keyframes.length]
        if (next === undefined) return false
        if (i + 1 < d.keyframes.length && next.atMinute <= k.atMinute) return false
        return k.holdMinutes < (next.atMinute - k.atMinute + 1440) % 1440
      }),
    {
      error: 'keyframes must be in clock order, each hold ending before the next',
      path: ['keyframes'],
    },
  )
  .refine(
    (d) =>
      d.keyframes.filter((k, i) => k.ui !== d.keyframes[(i + 1) % d.keyframes.length]?.ui)
        .length === 2,
    { error: 'the interface must switch to night once and back to day once', path: ['keyframes'] },
  )

const propsTier = <T extends z.ZodType>(value: T) => z.strictObject({ mid: value, high: value })
const chance = z.number().min(0).max(1)
const propModel = z.enum(STREET_PROP_MODELS)
const perChunk = propsTier(z.int().nonnegative())

/**
 * data/config/props.json, street dressing (S04i): hand-made props on the real LION street chains
 * of the prop zones (geo/streets.derived.json), placed on the client, seeded per chain, merged per
 * `chunkM` square onto the district material (one draw call per chunk, no new shader program)
 * and drawn only around the camera focus once the camera is within `showBelowDistanceM`. Off on
 * the low tier, which never fetches the streets. Distances are metres, `spacingM` along a chain.
 * Its own file, not a block of scene.json, because client islands bundle scene.json whole.
 */
export const StreetPropsConfigSchema = z
  .strictObject({
    /** Seed for src/engine/rng.ts, mixed with each chain's first point. */
    seed: z.int().nonnegative(),
    chunkM: metres,
    /** Props draw only while the camera is at most this far from its target. */
    showBelowDistanceM: propsTier(metres),
    /** The streets file and the prop models load once the camera comes this close. */
    prefetchBelowDistanceM: propsTier(metres),
    /** Chunks whose centre lies this far from the camera target at most are candidates. */
    focusRadiusM: propsTier(metres),
    /** From the curb onto the sidewalk (streetlights, trees, benches, hydrants, lights). */
    sidewalkOffsetM: metres.max(5),
    /** From the curb into the parking lane (parked cars). */
    parkingOffsetM: metres,
    /** No prop within this distance of a pin's ground point. */
    pinClearM: metres,
    /**
     * No street prop inside a procedural fill block's footprint grown by this much (S04i):
     * the blocks are not cut back for real streets, so props keep out of them instead.
     */
    blockClearM: z.number().nonnegative(),
    /** No prop along a chain within its half-width plus this of a junction. */
    junctionClearM: z.number().nonnegative(),
    /** Their `_emissive` vertices glow in the window colour at night (window-mask lit cell). */
    glowModels: z.array(propModel),
    /**
     * Per rule, at most `perChunk` props in one chunk (the ones ranked first by a hash of their
     * position), so a chunk never holds more than its share of perf.json `streetProps` caps.
     */
    rules: z.strictObject({
      streetlight: z.strictObject({
        spacingM: propsTier(metres),
        alternate: z.boolean(),
        perChunk,
      }),
      tree: z.strictObject({
        models: z.array(propModel).min(1),
        spacingM: propsTier(metres),
        chance,
        perChunk,
      }),
      hydrant: z.strictObject({ chance, perChunk }),
      bench: z.strictObject({
        nearPlacesM: metres,
        parkEdges: z.boolean(),
        spacingM: metres,
        perChunk,
      }),
      parked: z.strictObject({
        models: propsTier(z.array(propModel).min(1)),
        taxiShare: chance,
        /** Per parking slot, per tier. */
        chance: propsTier(chance),
        slotM: metres,
        perChunk,
      }),
      trafficLight: z.strictObject({ wideOnly: z.boolean(), chance, perChunk }),
      waterTower: z
        .strictObject({
          minHeightM: metres,
          maxHeightM: metres,
          chance,
          pinClearM: metres,
          perChunk,
        })
        .refine((tower) => tower.minHeightM <= tower.maxHeightM, {
          error: 'minHeightM must not exceed maxHeightM',
        }),
    }),
  })
  .refine(
    (props) =>
      (['mid', 'high'] as const).every(
        (tier) => props.showBelowDistanceM[tier] <= props.prefetchBelowDistanceM[tier],
      ),
    { error: 'props must load before they show: showBelowDistanceM <= prefetchBelowDistanceM' },
  )
export type StreetPropsConfig = z.infer<typeof StreetPropsConfigSchema>

/** Ambient vehicle models (S04l): reduced LODs of the street-prop cars, plus a CC0 bus. */
export const AMBIENT_VEHICLE_MODELS = [
  'sedan-ambient',
  'taxi-ambient',
  'hatchback-ambient',
  'bus-ambient',
] as const

const ambientTier = <T extends z.ZodType>(value: T) =>
  z.strictObject({ low: value, mid: value, high: value })
const speedRange = z
  .strictObject({ min: metres, max: metres })
  .refine((range) => range.min <= range.max, { error: 'min must not exceed max' })
const distanceScale = z.strictObject({
  /** Size multiplier per metre of camera distance (never below real size). */
  perDistance: z.number().nonnegative(),
  max: z.number().min(1),
})

/** The rig clips a townsperson can be posed in (src/scene/ambient/kitIds.ts). */
export const TOWNSFOLK_POSES = ['idle', 'talk', 'wave', 'walk'] as const

/**
 * The townsfolk (S04o): Sims-like locals drawn at the player's size, hanging out at the places
 * and walking between them, tappable for a small profile card. NPCs, never players (UX-3).
 */
const TownsfolkConfigSchema = z.strictObject({
  /** Locals who call each place home (their own slots; visitors take the gaps). */
  perVenue: ambientTier(z.int().min(1).max(8)),
  /** Drawn at once, nearest in view first. */
  maxShown: ambientTier(z.int().min(0).max(40)),
  /** Places within this of the camera target are simulated. */
  focusRadiusM: ambientTier(metres),
  /** Drawn only while the camera is at most this far from its target. */
  showBelowDistanceM: ambientTier(metres),
  /** Over this last share of `showBelowDistanceM` the locals shrink away (no pop). */
  fadeShare: z.number().gt(0).lt(1),
  /** A local's height as a share of the player's (scene.json `avatar`, × `playerScale`). */
  heightOfPlayer: z.number().gt(0).max(1.5),
  /** The hangout ring's centre this many metres in front of (south of) the place point. */
  frontM: z.number().nonnegative(),
  /** Ring spacing between neighbours, and its smallest radius, in local heights. */
  spacingOfHeight: z.number().positive(),
  minRingOfHeight: z.number().positive(),
  /** One hangout-then-walk cycle. */
  epochS: z.number().positive(),
  /** Walking pace in the local's own heights a second (a real person: about 0.75). */
  walkHeightsPerS: z.number().positive().max(2),
  /** Seconds a walk eases in and out over (no instant starts or stops). */
  easeS: z.number().nonnegative(),
  /** Seconds a local turns on the spot before setting off and after arriving. */
  turnS: z.number().positive(),
  /** Heading look-ahead round corners, in local heights (larger: wider, smoother turns). */
  turnLookOfHeight: z.number().positive(),
  /** Locals keep to the sidewalk this far (in their heights) beyond the street's kerb. */
  sidewalkOfHeight: z.number().nonnegative(),
  /** A street route longer than this × the straight line is walked straight instead. */
  maxDetour: z.number().min(1),
  /** The street node a place's walkers step onto is at most this far from its ring. */
  accessM: metres,
  /** Walking takes at most this share of a cycle: farther places are never visited. */
  maxWalkShare: z.number().gt(0).lt(1),
  /** How many of the nearest places a local visits. */
  neighbours: z.int().min(0).max(8),
  /** Chance a cycle is spent at home. */
  homeShare: chance,
  /** The poses each tier bakes (4 draw calls per pose and model); `walk` for walking. */
  poses: ambientTier(
    z
      .array(z.enum(TOWNSFOLK_POSES))
      .min(1)
      .refine((poses) => new Set(poses).size === poses.length, { error: 'duplicate pose' }),
  ),
  /** Chance a hangout is spent talking or waving (where the tier has the pose); else idle. */
  poseShare: z
    .strictObject({ talk: chance, wave: chance })
    .refine((share) => share.talk + share.wave <= 1, { error: 'pose shares exceed 1' }),
  /** A ring stay is split into segments this long, each idle or talking (S04r). */
  segmentS: z.number().positive(),
  /** Seconds a hello or goodbye wave lasts. */
  waveS: z.number().positive(),
  /**
   * Crews (S04r): a place's locals in pairs (a trio when odd) sharing a clock. In a cycle that
   * meets (`meetShare`) a crew huddles at one place, members `huddleOfHeight` from its middle,
   * which stands `outOfHeight` beyond the ring; they talk `talkShare` of the time, and a crew
   * walking on together keeps `laneOfHeight` apart side by side.
   */
  crew: z.strictObject({
    meetShare: chance,
    talkShare: chance,
    huddleOfHeight: z.number().positive(),
    outOfHeight: z.number().nonnegative(),
    laneOfHeight: z.number().nonnegative(),
  }),
  /**
   * Stays spent inside (S04r): the local walks to the door (`doorM` south of the place point),
   * walks in `stepOfHeight` while it shrinks away over `fadeS`, and comes back out the same way.
   */
  inside: z.strictObject({
    share: chance,
    doorM: z.number().nonnegative(),
    fadeS: z.number().positive(),
    stepOfHeight: z.number().nonnegative(),
  }),
  /**
   * A stroll mid-stay (S04r): a loop out to a point `outOfHeight` beyond the ring and back, as
   * wide as `loopShare` of its length.
   */
  stroll: z.strictObject({
    share: chance,
    outOfHeight: z.number().nonnegative(),
    loopShare: z.number().nonnegative().max(1),
  }),
  /** A local standing idle (`share` of them) waves while another walks past within the radius. */
  passWave: z.strictObject({ share: chance, radiusOfHeight: z.number().positive() }),
  /**
   * How strongly a place draws visitors, by venue type, as [day, night] weights (1 when not
   * listed): clubs and lounges fill up at night, food spots and coffee by day.
   */
  pull: z.record(
    z.string().regex(/^[a-z][a-z0-9-]*$/),
    z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  ),
  /**
   * Animation frames baked from each pose's rig clip (src/scene/ambient/pedestrianKits.ts):
   * the walk cycle, and each standing pose's (idle, talk, wave) loop.
   */
  frames: z.strictObject({
    walk: ambientTier(z.int().min(2).max(32)),
    stand: ambientTier(z.int().min(1).max(32)),
  }),
  /**
   * Walkers are split into this many groups stepping out of phase with each other (each group
   * one more set of draw calls per body), so a crowd never marches in step.
   */
  phaseGroups: ambientTier(z.int().min(1).max(4)),
  faceJitterRad: z.number().nonnegative(),
  /** Hair (and shoe) colours: the kits' `accent` bucket. */
  hair: z.array(HEX).min(1),
  names: z.strictObject({
    woman: z.array(z.string().min(1).max(16)).min(1),
    man: z.array(z.string().min(1).max(16)).min(1),
    initials: z.string().regex(/^[A-Z]+$/),
  }),
  /** Vibe ids: copy keys `townsfolk.vibe.<id>`. */
  vibes: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)).min(1),
})

const lngLatAlt = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().nonnegative(),
])

/**
 * The sky (S04q, src/lib/world/ambient/planes.ts): airliners on the Queens airports' approach and
 * departure paths and a helicopter looping over Manhattan. Every tier flies at least one plane
 * (DEC-52: always alive); altitudes are map altitudes, compressed like the game map's buildings.
 */
const PlanesConfigSchema = z.strictObject({
  /** Airliners drawn at once (nearest the camera target first); at least 1 on every tier. */
  maxShown: ambientTier(z.int().min(1).max(8)),
  helicopters: ambientTier(z.int().min(0).max(2)),
  speedMps: metres,
  /** An airliner's real length; drawn larger far out (`scale`, as the cars are). */
  lengthM: metres,
  scale: distanceScale,
  /** Curve samples between two waypoints. */
  samplesPerSpan: z.int().min(2).max(64),
  /** Heading, climb and bank look this far ahead and behind along the route. */
  lookM: metres,
  /** Bank per radian of heading change over 2 × `lookM`, capped at `maxBankRad`. */
  bankGain: z.number().nonnegative(),
  maxBankRad: z.number().nonnegative().max(1),
  /** Seconds a flight grows in after take-off and shrinks away before landing. */
  fadeS: z.number().positive(),
  helicopter: z.strictObject({ speedMps: metres, lengthM: metres, rotorHz: z.number().positive() }),
  lights: z.strictObject({
    /** White wingtip strobes: a flash of `strobeOnS` every `strobePeriodS`. */
    strobePeriodS: z.number().positive(),
    strobeOnS: z.number().positive(),
    /** The red beacon's blink period (half on, half off). */
    beaconPeriodS: z.number().positive(),
    /** Lamp box size, as a share of the aircraft's length. */
    navM: z.number().positive().max(0.2),
  }),
  colors: z.strictObject({
    body: HEX,
    accent: HEX,
    helicopter: HEX,
    lamp: HEX,
    red: HEX,
    green: HEX,
    white: HEX,
  }),
  routes: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]+$/),
        kind: z.enum(['arrival', 'departure', 'overflight', 'helicopter']),
        points: z.array(lngLatAlt).min(2),
        /** Seconds between two flights on the route (a closed route loops one aircraft). */
        headwayS: z.number().positive(),
        offsetS: z.number().nonnegative(),
        closed: z.boolean(),
      }),
    )
    .min(1)
    .refine((routes) => routes.some((route) => route.kind !== 'helicopter'), {
      error: 'the sky needs at least one airliner route',
    }),
  /** Passing flights over the camera's part of the city (planes.ts documents them). */
  passing: z.strictObject({
    cellM: metres,
    headwayS: z.number().positive(),
    lengthM: metres,
    altM: z
      .tuple([z.number().nonnegative(), z.number().nonnegative()])
      .refine(([low, high]) => low <= high, { error: 'low above high' }),
    jitter: z.number().min(0).max(0.5),
    headingJitterRad: z.number().nonnegative().max(1),
    airports: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(1),
  }),
})

/**
 * data/config/ambient.json, the living city (S04l, DEC-52): ambient traffic, pedestrians and
 * subway trains, deterministic from `seed` and the city clock (src/lib/world/ambient/). Counts
 * here are per-slot densities; what may be drawn at once is capped by perf.json `ambient`.
 * Distances are metres, times seconds. Its own file (read by the lazy ambient chunk only).
 */
export const AmbientConfigSchema = z.strictObject({
  seed: z.int().nonnegative(),
  /** Vehicle slots belong to squares of this side. */
  cellM: metres,
  /** The ambient ticker requests at most this many frames per second. */
  fpsCap: ambientTier(z.int().min(1).max(120)),
  /** Vehicle cells and pedestrian anchors within this of the camera target are simulated. */
  focusRadiusM: ambientTier(metres),
  density: z.strictObject({
    /** Active slot share at each FPS step-down level, level 0 first, descending. */
    steps: z
      .array(z.number().gt(0).max(1))
      .min(1)
      .refine((steps) => steps.every((s, i) => i === 0 || s < (steps[i - 1] ?? 1)), {
        error: 'density steps must descend',
      }),
    /** Multiplier on the share at night (personal game clock). */
    night: z.number().gt(0).max(1),
  }),
  /** While ambient is the only continuous source, the step-down's FPS floor. */
  stepDown: z.strictObject({ belowFps: ambientTier(z.number().positive()) }),
  lights: z.strictObject({
    cycleS: z.number().positive(),
    greenShare: z.number().gt(0).max(0.5),
    stopGapM: z.number().nonnegative(),
    queueGapM: z.number().nonnegative(),
    axisCos: z.number().gt(0).lt(1),
    minEnds: z.int().min(3),
  }),
  vehicles: z.strictObject({
    models: ambientTier(z.array(z.enum(AMBIENT_VEHICLE_MODELS)).min(1)),
    taxiShare: chance,
    busShare: chance,
    busWideOnly: z.boolean(),
    perCell: ambientTier(z.int().min(0).max(7)),
    speedMps: speedRange,
    laneOffsetRatio: z.number().positive().max(1),
    minLaneOffsetM: metres,
    epochS: z.number().positive(),
    cohorts: z.int().min(1),
    fadeS: z.number().positive(),
    brakeS: z.number().positive(),
    lengthM: metres,
    /** Cars draw only while the camera is at most this far from its target. */
    showBelowDistanceM: ambientTier(metres),
    scale: distanceScale,
    /**
     * However far out, a car is never drawn longer than this share of the map style's tallest
     * person (scene.json `characterMaxM`, S04q): zoomed out, cars never outgrow the people or
     * the houses beside them.
     */
    maxLengthOfCharacter: z.number().positive().max(4),
    paint: z.array(HEX).min(1),
  }),
  pedestrians: z.strictObject({
    /** Where pedestrian kits come from (the S16b seam): the merged `npc-*` models. */
    source: z.enum(['s16b']),
    anchors: z.array(z.enum(['place', 'home', 'landmark'])).min(1),
    anchorRadiusM: metres,
    perAnchor: ambientTier(z.int().min(0).max(7)),
    speedMps: speedRange,
    sidewalkOffsetM: metres.max(5),
    sidewalkJitterM: z.number().nonnegative(),
    epochS: z.number().positive(),
    fadeS: z.number().positive(),
    showBelowDistanceM: ambientTier(metres),
    scale: distanceScale,
    bobM: z.number().nonnegative(),
    bobHz: z.number().positive(),
    lookOnlyMarginM: z.number().nonnegative(),
    palette: z.strictObject({
      skin: z.array(HEX).min(1),
      tops: z.array(HEX).min(1),
      bottoms: z.array(HEX).min(1),
    }),
  }),
  trains: z.strictObject({
    speedMps: z.number().positive(),
    dwellS: z.number().nonnegative(),
    headwayS: z.number().positive(),
    cars: ambientTier(z.int().min(1).max(8)),
    /**
     * A car's real size; far out it grows like the trip's train (avatar height × scene.json
     * `travel` ratios), never smaller than this.
     */
    carLengthM: metres,
    carWidthM: metres,
    carHeightM: metres,
    gapRatio: z.number().nonnegative(),
    stationSnapM: metres,
    minStopGapM: z.number().nonnegative(),
    lookOnlyMarginM: z.number().nonnegative(),
    lookOnlyFadeM: z.number().nonnegative(),
  }),
  /** How the vehicle kits sort baked colours into buckets (src/scene/ambient/vehicleKits.ts). */
  vehicleKit: VehicleKitConfigSchema,
  townsfolk: TownsfolkConfigSchema,
  planes: PlanesConfigSchema,
})
export type AmbientConfigFile = z.infer<typeof AmbientConfigSchema>

const TOKEN = z.string().regex(/^[a-z]+-\d{2,3}$/)
const MODEL_ID = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export { MAP_STYLES, type MapStyleId } from '@/lib/world/mapStyleIds'

const tierRatios = z.strictObject({ low: ratio.max(1), mid: ratio.max(1), high: ratio.max(1) })

/**
 * One map style: its default camera, how the background city is drawn, whether places stand on
 * plots (plots.json), how pins and their icon bubbles look, and theme world tokens that replace
 * the base palette's (theme.json `scene`) while it is shown. Both styles share every material and
 * shader program: a switch changes colours, heights, visibility and instance data only.
 */
const MapStyleSchema = z.strictObject({
  camera: z.strictObject({
    distanceM: metres,
    /** The distance on a portrait screen (a phone), which shows far less of the map across. */
    portraitDistanceM: metres,
    polarDeg: z.number().min(0).lt(90),
    /**
     * On a wide screen (camera/FreeRowFraming.tsx `wideFraming`) the camera starts this far from
     * the home, local metres (+y north), so the home and its venues fill the free area: the game
     * map's cluster centre (compactLayout.json `centreOffsetM`, S04p). None: over the home.
     */
    wideStartOffsetM: z.strictObject({ x: z.number(), y: z.number() }).optional(),
    /** The pitch on a portrait screen (S41b). None: `polarDeg`. */
    portraitPolarDeg: z.number().min(0).lt(90).optional(),
    /**
     * On a portrait screen the camera starts this far from the home (as `wideStartOffsetM`), so
     * the home's cluster fills the phone's free scene row (S41b). None: over the home.
     */
    portraitStartOffsetM: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  }),
  buildings: z.strictObject({
    /** District masses and fill blocks are drawn at this share of their real height. */
    heightScale: ratio.max(1),
    /** Multiplies the tier's perf.json buildingDensity. */
    densityScale: tierRatios,
  }),
  /**
   * Places and homes stand on plots with a building (data/config/plots.json), and venues at
   * their compact game positions (the places layer's `gx`/`gy`, data/config/compactLayout.json).
   */
  plots: z.boolean(),
  /**
   * The subway ribbons rise this much above `subway.liftM`: over a flattened background the
   * elevated lines would otherwise meet the roofs of the masses under them.
   */
  subwayLiftM: z.number().nonnegative(),
  /**
   * The tallest the map's people (the player and the townsfolk) are ever drawn, in metres. They
   * grow with the camera distance to stay readable, but never past this: about half the
   * smallest building beside them (plots.json buildings on the game map, a Queens row house on
   * the real one), so zooming out never shows people taller than the houses.
   */
  characterMaxM: metres,
  pins: z.strictObject({
    /** Venue pins float over their plot buildings (the places layer's lift). */
    venueLift: z.boolean(),
    /** Venue pins draw their cone; off, the icon bubble alone marks the place. */
    venueCones: z.boolean(),
  }),
  /** Overrides of data/config/pinMarks.json. */
  marks: z.strictObject({
    iconPx: metres,
    labelPx: metres,
    maxLabels: z.int().min(0).max(32),
    ringWidth: ratio.max(0.3),
    pullToCamera: z.number().min(0).max(2),
    /**
     * On a portrait screen (S41b), whose default view packs about twice the places into each
     * screen width, the bubbles and labels shrink to these sizes and fewer names show.
     */
    portrait: z
      .strictObject({ iconPx: metres, labelPx: metres, maxLabels: z.int().min(0).max(32) })
      .optional(),
  }),
  colors: z.strictObject({
    walls: z.array(TOKEN).min(1).optional(),
    roof: TOKEN.optional(),
    /** The fill blocks' colours (theme.json `scene.buildings.blocks`). */
    blocks: z.array(TOKEN).min(1).optional(),
    land: z.record(z.string(), TOKEN).optional(),
    park: TOKEN.optional(),
    /**
     * The water: each day/night keyframe's water colour is scaled per channel by this colour
     * over the base palette's water, so night water stays dark.
     */
    water: TOKEN.optional(),
  }),
})
export type MapStyle = z.infer<typeof MapStyleSchema>

export const MapStylesSchema = z.strictObject({
  default: z.enum(MAP_STYLES),
  game: MapStyleSchema,
  real: MapStyleSchema,
})
export type MapStyles = z.infer<typeof MapStylesSchema>

export const SceneConfigSchema = z.strictObject({
  /** The camera starts over the player's home (data/homes/homes.json), not a fixed point. */
  camera: z
    .strictObject({
      fovDeg: z.number().gt(0).lt(180),
      distanceM: metres,
      minDistanceM: metres,
      maxDistanceM: metres,
      /** 0 looks straight down; keep it under 90 so the camera stays above the ground. */
      polarDeg: AngleRangeSchema.refine((a) => a.min >= 0 && a.max < 90, {
        error: 'polar angles must lie in [0, 90)',
      }),
      /** 0 is north-up; the range must stay within one turn. */
      azimuthDeg: AngleRangeSchema.refine((a) => a.min >= -180 && a.max <= 180, {
        error: 'azimuth angles must lie in [-180, 180]',
      }),
      /** The near plane follows the camera distance, clamped, to keep depth precision. */
      nearPerDistance: ratio,
      nearMinM: metres,
      nearMaxM: metres,
      /** The far plane is fixed at this multiple of maxDistanceM. */
      farPerMaxDistance: z.number().min(1),
    })
    .refine((c) => c.minDistanceM <= c.distanceM && c.distanceM <= c.maxDistanceM, {
      error: 'distanceM must lie within minDistanceM..maxDistanceM',
      path: ['distanceM'],
    })
    .refine((c) => c.nearMinM <= c.nearMaxM, {
      error: 'nearMinM must not exceed nearMaxM',
      path: ['nearMinM'],
    }),
  /** Borough land is extruded `heightM` deep with its bottom `baseM` below the water plane. */
  land: z
    .strictObject({ heightM: metres, baseM: z.number().nonnegative() })
    .refine((land) => land.baseM < land.heightM, {
      error: 'baseM must be below heightM so the land shows above the water',
    }),
  /** The water plane extends this far beyond the sea polygon. */
  water: z.strictObject({ extraM: z.number().nonnegative() }),
  /** Parks sit this far above the land top. */
  parks: z.strictObject({ liftM: metres }),
  subway: z.strictObject({
    liftM: metres,
    lineWidthPx: z.number().positive(),
    /** A dark casing under the ribbons (S04b turns it off on the low tier). */
    casing: z.boolean(),
    casingWidthPx: z.number().positive(),
  }),
  stations: z
    .strictObject({
      radialSegments: z.int().min(3),
      heightM: metres,
      /** Marker radius grows with camera distance (clamped) so stations stay visible. */
      radiusPerDistance: ratio,
      minRadiusM: metres,
      maxRadiusM: metres,
      /** Markers are rescaled when the distance changes by more than this factor. */
      rescaleRatio: z.number().gt(1),
    })
    .refine((s) => s.minRadiusM <= s.maxRadiusM, {
      error: 'minRadiusM must not exceed maxRadiusM',
    }),
  /**
   * The player's avatar placeholder (S05): a toon capsule on a flat ring at the player's home.
   * Like the station markers it grows with camera distance (clamped), so it stays visible from
   * the default view and never towers over the street up close. Ratios are of its height.
   */
  avatar: z
    .strictObject({
      heightPerDistance: ratio,
      minHeightM: metres,
      maxHeightM: metres,
      /**
       * S16b: the player's own marker (capsule, ring and character) is drawn this many times the
       * base size above, so the person reads clearly on the map at every zoom; trip vehicles and
       * trains keep the base size.
       */
      playerScale: z.number().min(1).max(10),
      /** Capsule radius. */
      radiusRatio: z.number().gt(0).lt(0.5),
      ringOuterRatio: ratio,
      ringInnerRatio: z.number().nonnegative(),
      /** The ring floats this far above the land so it never fights it in the depth test. */
      ringLiftRatio: z.number().nonnegative().max(0.1),
      capSegments: z.int().min(1).max(16),
      radialSegments: z.int().min(3).max(32),
      ringSegments: z.int().min(3).max(64),
    })
    .refine((a) => a.minHeightM <= a.maxHeightM, {
      error: 'minHeightM must not exceed maxHeightM',
    })
    .refine((a) => a.ringInnerRatio < a.ringOuterRatio, {
      error: 'ringInnerRatio must be less than ringOuterRatio',
    }),
  labels: z.strictObject({
    /** Line letters are hidden when the camera is farther than this. */
    maxDistanceM: metres,
    chipSizeM: metres,
    chipGapM: z.number().nonnegative(),
    /** Chips sit this far north of their terminal station. */
    offsetM: z.number().nonnegative(),
    liftM: metres,
    atlasCellPx: z.int().min(16).max(256),
    alphaTest: z.number().gt(0).lt(1),
    /** Chip artwork, as fractions of an atlas cell (chip, corner radius, letter size, text width). */
    chipFill: z.number().gt(0).max(1),
    cornerRadius: z.number().nonnegative().max(0.5),
    fontScale: z.number().gt(0).max(1),
    textMaxWidth: z.number().gt(0).max(1),
  }),
  lights: z.strictObject({
    /**
     * The high tier's directional shadow (S04b, perf.json `shadows`). The light follows the
     * camera target so its shadow map covers the view; sizes are multiples of the camera
     * distance so the shadow stays sharp at every zoom.
     */
    shadow: z.strictObject({
      /** Half the width of the square the shadow map covers. */
      extentPerDistance: ratio,
      /** How far towards the sun the light sits from the target. */
      lightPerDistance: ratio,
      /** Depth of the shadow camera, from the light. */
      depthPerDistance: ratio,
      bias: z.number().max(0),
      normalBias: z.number().nonnegative(),
    }),
  }),
  /**
   * The day/night cycle on the personal game clock (S04f): keyframes the city's sun, ambient and
   * hemisphere light, fog and night glow blend between. Colours are theme.json `sky.<id>`.
   * `src/lib/dayNight/resolveDayNight.ts` checks clock order and holds when the model is built.
   */
  dayNight: DayNightConfigSchema,
  /**
   * How the 3D map starts (S04b, PERF-4): the canvas mounts when the main thread is idle (or
   * after `idleTimeoutMs` at the latest), and the city build yields to the browser between
   * layers so taps and other islands are not blocked for its whole length.
   */
  startup: z.strictObject({
    idleTimeoutMs: z.int().positive(),
  }),
  /** "Expanding soon" land and parks (S04c): their colour mixed this far towards theme `scene.haze`. */
  dimmed: z.strictObject({ towardBackground: z.number().gt(0).lt(1) }),
  /** Place pins (S04c): instanced markers whose height follows the camera distance, clamped. */
  pins: z
    .strictObject({
      liftM: z.number().nonnegative(),
      heightPerDistance: ratio,
      minHeightM: metres,
      maxHeightM: metres,
      /** Pins are rescaled when the distance changes by more than this factor. */
      rescaleRatio: z.number().gt(1),
      radialSegments: z.int().min(3),
      /**
       * Screen radius of a pin's tap target. At least 22 px, so the target is at least 44 px
       * across (CLAUDE.md "Art direction": hit targets ≥ 44 px).
       */
      hitRadiusPx: z.number().min(22),
      /** Pins this close to the nearest hit (in pixels) make the tap ambiguous: a chooser opens. */
      ambiguityPx: z.number().nonnegative(),
      /** A pointer that moves farther than this, or stays down longer, is a drag, not a tap. */
      tapSlopPx: z.number().positive(),
      tapMaxMs: z.int().positive(),
      /** Selection ring radius as a fraction of the pin height. */
      ringRadius: ratio,
      ringSegments: z.int().min(8),
      /**
       * Night glow lift (S04f): at full night a pin glows this share of its own colour, so it
       * stays readable and tappable in the dark. Muted pins never glow.
       */
      nightGlow: z.number().min(0).max(1),
    })
    .refine((p) => p.minHeightM <= p.maxHeightM, {
      error: 'minHeightM must not exceed maxHeightM',
    }),
  /** The camera move to a place picked outside the map (the Places panel, a hook). */
  focus: z.strictObject({
    tweenMs: z.int().nonnegative(),
    /** The camera ends at most this far from the place. */
    maxDistanceM: metres,
    /** The Map tab's glide back to the player at the default view (src/state/mapTab.ts). */
    recenterMs: z.int().nonnegative(),
  }),
  /**
   * Travel (S08): the vehicle the avatar rides in, sized as a multiple of the avatar's height (so
   * it scales with the camera like the avatar), and the trail drawn behind it (at most
   * `trailMaxPoints` points, one line; off on the low tier unless `trailOnLow`).
   */
  travel: z.strictObject({
    taxiLengthRatio: z.number().gt(0),
    trainLengthRatio: z.number().gt(0),
    vehicleWidthRatio: z.number().gt(0),
    vehicleHeightRatio: z.number().gt(0),
    /** A trail point is added each time the traveller moves this much (avatar heights). */
    trailStepRatio: z.number().gt(0),
    /** The trail's height above the land top (avatar heights). */
    trailLiftRatio: z.number().nonnegative(),
    trailMaxPoints: z.int().min(2).max(64),
    trailWidthPx: z.number().gt(0),
    trailOnLow: z.boolean(),
  }),
  /** "Expanding soon" ground chips on dimmed boroughs, drawn from a runtime atlas. */
  chips: z.strictObject({
    widthM: metres,
    heightM: metres,
    liftM: metres,
    atlasWidthPx: z.int().min(64).max(2048),
    atlasHeightPx: z.int().min(16).max(1024),
    fontScale: z.number().gt(0).max(1),
    textMaxWidth: z.number().gt(0).max(1),
    cornerRadius: z.number().nonnegative().max(0.5),
    alphaTest: z.number().gt(0).lt(1),
  }),
  /**
   * The hand-made models (S04h, DEC-24). `lit` (MeshStandardMaterial on mid/high, Lambert on low)
   * is the default until the user picks from the showcase; `toon` uses the shared toon ramp.
   * Colours come from each model's vertex colours (theme.json `models` tokens).
   */
  models: z.strictObject({
    shading: z.enum(['lit', 'toon']),
    /** Material per quality tier when shading is `lit`. */
    litMaterial: z.strictObject({
      low: z.enum(['lambert', 'standard']),
      mid: z.enum(['lambert', 'standard']),
      high: z.enum(['lambert', 'standard']),
    }),
    roughness: z.number().min(0).max(1),
    metalness: z.number().min(0).max(1),
    /** `_EMISSIVE` vertices (lit windows, lamps) glow at this intensity by day and by night. */
    emissive: z.strictObject({
      dayIntensity: z.number().nonnegative(),
      nightIntensity: z.number().nonnegative(),
    }),
    /** Decoded models kept in memory after their last user unmounts (LRU). */
    cacheMaxEntries: z.int().min(1),
    /**
     * The player's hand-made avatar on the map (S05 swap): this rig, head and body (until the
     * HUD has read the look), posed on `clip`. The capsule placeholder stays while it loads, if
     * it fails, on devices reporting less than `minDeviceMemoryGB` (navigator.deviceMemory),
     * and on the tiers in `capsuleTiers` (S16b: none; the low tier draws the low-LOD model).
     */
    player: z.strictObject({
      rig: z.string().regex(/^avatar-rig-[a-z0-9-]+$/),
      head: z.string().regex(/^head-[a-z0-9-]+$/),
      body: z.string().regex(/^outfit-[a-z0-9-]+$/),
      clip: z.string().min(1),
      minDeviceMemoryGB: z.number().positive(),
      capsuleTiers: z.array(z.enum(['low', 'mid', 'high'])),
    }),
    /**
     * Apartment decor drawn with a hand-made model (S16 + S04h): decor item id → model id and the
     * model slot the player's colour variant recolours (null for a model with one look). Items
     * left out keep their code-built stand-in (string lights, the neon sign and the prints).
     */
    decor: z.record(
      z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      z.strictObject({
        model: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        slot: z.string().min(1).nullable(),
      }),
    ),
  }),
  /** The static SVG map (GET /geo/fallback) shown when the 3D map is unavailable. */
  fallback: z.strictObject({
    /** SVG user units are whole multiples of this many metres. */
    metresPerUnit: metres,
    /** Douglas-Peucker tolerance for outlines. */
    toleranceM: metres,
    /** Land and park polygons smaller than these are left out. */
    minLandAreaM2: z.number().nonnegative(),
    minParkAreaM2: z.number().nonnegative(),
    dotRadiusM: metres,
    labelSizeM: metres,
    labelOpacity: z.number().gt(0).max(1),
    dimmedLabelOpacity: z.number().gt(0).max(1),
  }),
  /**
   * The apartment interior (S16, S40, src/scene/apartment/): the floor slab, wall thickness and
   * trims, the small tables under surface items, how much of its footprint an item fills, where
   * wall items hang, the buy-mode grid overlay, the camera fit, the lights and the mid tier's
   * blob shadows.
   */
  apartment: z.strictObject({
    floorThicknessM: metres,
    /** Trim, panes and doors sit this far in front of their wall so they never fight it in the depth test. */
    insetM: metres,
    trimHeightM: metres,
    /** Walls are boxes this thick with a darker cap, read from above like a doll's house. */
    wallThicknessM: metres,
    crownHeightM: metres,
    /** The small table a surface item stands on: its height and how far it sits in from the cell edge. */
    standHeightM: metres,
    standInsetM: z.number().nonnegative(),
    /** A model is scaled down (never up) to this share of its footprint. */
    footprintFill: z.number().gt(0).max(1),
    /** A wall item hangs at this share of the ceiling height. */
    wallItemHeight: z.number().gt(0).lt(1),
    /** The player's avatar stands this tall in the room (S16a's model scaled to fit). */
    avatarHeightM: metres,
    /** Buy mode's grid overlay: the gap between cell tiles (share of a cell), lift and opacity. */
    grid: z.strictObject({
      gapShare: z.number().min(0).lt(0.5),
      liftM: z.number().nonnegative(),
      opacity: z.number().gt(0).max(1),
    }),
    /** The room's projected box fills the free scene area with this much margin. */
    fitMargin: z.number().min(1),
    /**
     * Turning the room (S40b, src/scene/apartment/RoomOrbit.tsx): one finger or the mouse turns
     * it all the way round and tilts it between the polar limits (degrees from straight down,
     * widened to take in the home's own angle), a pinch or the wheel zooms between shares of the
     * fitted distance, never closer than `outsideShare` of the room's bounding radius (so the
     * camera never enters a wall or the floor). `damping` is three's OrbitControls factor;
     * `resetEase` the share of the way back to the home view covered per frame. A second tap on
     * the backdrop within `doubleTapMs` and `doubleTapSlopPx` of the first resets the view.
     */
    orbit: z
      .strictObject({
        minPolarDeg: z.number().min(0).lt(90),
        maxPolarDeg: z.number().gt(0).lt(90),
        zoomInShare: z.number().gt(0).max(1),
        zoomOutShare: z.number().min(1),
        outsideShare: z.number().gt(1),
        damping: z.number().gt(0).max(1),
        rotateSpeed: z.number().positive(),
        zoomSpeed: z.number().positive(),
        resetEase: z.number().gt(0).max(1),
        doubleTapMs: z.int().positive(),
        doubleTapSlopPx: z.number().positive(),
      })
      .refine((o) => o.minPolarDeg < o.maxPolarDeg, {
        error: 'the orbit needs a tilt range',
      }),
    /**
     * The room's light comes from the city's day/night keyframe (scene `dayNight.room` scales
     * it); only the direction through the window and the shadow map size are the room's own.
     */
    lights: z.strictObject({
      sunDirection: z
        .strictObject({ x: z.number(), y: z.number(), z: z.number() })
        .refine((d) => d.y > 0, { error: 'the light must come from above' }),
      /** The high tier's one directional shadow map (PCFShadowMap). */
      shadowMapSizePx: z.int().min(256).max(4096),
    }),
    /** The mid tier's blob shadows under placed floor and surface decor. */
    blob: z.strictObject({
      radiusM: metres,
      opacity: z.number().gt(0).max(1),
      liftM: z.number().nonnegative(),
    }),
  }),
  /** The landmark kit's levels of detail and look per quality tier (S07a). */
  landmarks: LandmarkSceneConfigSchema,
  /** The switchable map styles (S04m). */
  mapStyles: MapStylesSchema,
  /**
   * District buildings and procedural blocks (S04d). Windows are a mask texture repeated over
   * the district walls (one cell per `floorM` storey and `windowSpacingM` of wall), glowing with
   * the shared night-glow uniform (src/scene/lighting/nightGlow.ts, driven by S04f's day/night
   * rig); view distances are multiplied by the tier's lodDistanceScale.
   */
  buildings: z.strictObject({
    floorM: metres,
    windowSpacingM: metres,
    /** The window's share of its cell, across and up. */
    windowWidth: z.number().gt(0).lt(1),
    windowHeight: z.number().gt(0).lt(1),
    /** Share of windows lit at night. */
    litShare: z.number().min(0).max(1),
    /**
     * The window mask texture repeats every this many cells each way, so lit and dark windows
     * vary within the tile.
     */
    windowTileCells: z.int().min(1).max(16),
    /**
     * Mip bias of the window mask (TUNE-16): above 0, a wall reads the mask's averaged mips
     * sooner, so distant facades glow evenly instead of showing one-pixel dotted windows.
     */
    windowMipBias: z.number().min(0).max(4),
    /** The window pattern costs fragment work: off where the tier has no headroom. */
    windows: z.strictObject({ low: z.boolean(), mid: z.boolean(), high: z.boolean() }),
    /** Per-building spread of the facade's brightness (0.12 = plus or minus 12%). */
    wallJitter: z.number().min(0).max(0.5),
    /** Beyond these distances from the camera, districts and blocks are not drawn. */
    viewM: z.strictObject({ districts: metres, blocks: metres }),
    /** A district loads once the camera is this close to its draw distance. */
    loadMarginM: z.number().nonnegative(),
    /** The longest a build slice runs before it gives the browser a turn. */
    buildSliceMs: z.number().positive(),
    /**
     * Fill-lite (S04i): each procedural block becomes a low plate split into lots of seeded
     * heights, with street trees in the gaps between blocks, all in the blocks' instanced meshes
     * and materials (no new shader program). Low keeps one box per block and no trees.
     */
    fill: z.strictObject({
      /** Lots per block; 0 draws the block as one box. */
      lots: z.strictObject({
        low: z.int().min(0).max(8),
        mid: z.int().min(0).max(8),
        high: z.int().min(0).max(8),
      }),
      /** A plate under the lots (sidewalk and lot ground), in the theme's lot colour. */
      plate: z.strictObject({ low: z.boolean(), mid: z.boolean(), high: z.boolean() }),
      plateHeightM: metres,
      /** Gap between neighbouring lots, and the lots' inset from the plate's edge. */
      lotGapM: z.number().nonnegative(),
      /** Seeded spread of a lot's height around its block's (0.45 = plus or minus 45%). */
      lotHeightJitter: z.number().min(0).max(0.9),
      /** Street trees per block, set in the street gap beside it. */
      streetTreesPerBlock: z.strictObject({
        low: z.int().min(0).max(8),
        mid: z.int().min(0).max(8),
        high: z.int().min(0).max(8),
      }),
      /** Trees draw only within this distance of the camera (before lodDistanceScale). */
      treeViewM: z.strictObject({
        low: z.number().nonnegative(),
        mid: z.number().nonnegative(),
        high: z.number().nonnegative(),
      }),
      /** Height of a tree crown; its width is `treeWidthRatio` of that. */
      treeSizeM: metres,
      treeWidthRatio: ratio.max(2),
    }),
  }),
  /**
   * Name chips of the modelled landmarks (S07a): one flat rounded plate per landmark, floating
   * above its model's top and `offsetM` south of its pin, all in one mesh and one atlas, shown
   * within `landmarks.labelMaxDistanceM` of the camera target. Text comes from the server's copy
   * (generic labels for generic-name landmarks), never from the model data.
   */
  landmarkChips: z.strictObject({
    widthM: metres,
    heightM: metres,
    offsetM: z.number().nonnegative(),
    liftM: z.number().nonnegative(),
    atlasWidthPx: z.int().min(64).max(2048),
    cellHeightPx: z.int().min(16).max(256),
    fontScale: ratio.max(1),
    textMaxWidth: ratio.max(1),
    cornerRadius: z.number().min(0).max(0.5),
    alphaTest: z.number().gt(0).lt(1),
    /**
     * Chips are full size from this camera distance out; closer in (a focus view) each shrinks
     * about its own centre in proportion, down to `minScale`, so a chip never covers the models
     * around the one in focus (S07c).
     */
    fullSizeDistanceM: metres,
    minScale: ratio.max(1),
  }),
  /** The look runtime (S16a): accessory placement and the creator preview's studio light. */
  avatarLook: z.strictObject({
    /**
     * Where each Kenney accessory sits on the avatar (S16a): the rig joint it follows and its
     * offset in metres in the character's bind pose (the pipeline grounds static models at
     * y = 0). Blender attachments (part A0) carry their own frame and need no entry.
     */
    attachments: z.record(
      z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      z.strictObject({ joint: z.string().min(1), offset: VEC3 }),
    ),
    /**
     * The creator preview's fixed studio light (S16a, D11): the day keyframe's look, so swatches
     * always read true; it never follows the day/night clock.
     */
    preview: z.strictObject({
      background: HEX,
      ambient: z.strictObject({ color: HEX, intensity: z.number().min(0) }),
      hemisphere: z.strictObject({ sky: HEX, ground: HEX, intensity: z.number().min(0) }),
      sun: z.strictObject({ color: HEX, intensity: z.number().min(0), position: VEC3 }),
      camera: z.strictObject({
        fovDeg: z.number().min(5).max(90),
        position: VEC3,
        target: VEC3,
      }),
      clip: z.string().min(1),
    }),
  }),
})
export type SceneConfig = z.infer<typeof SceneConfigSchema>

/**
 * data/config/pinMarks.json. Pin marks (S04k, src/scene/pins/buildPinMarks.ts): a category icon on every playable pin's head
 * (`iconPx` CSS pixels across, whatever the zoom) and a short name label over the nearest
 * venues and unmodelled landmarks (at most `maxLabels`, within `labelRadiusM` of the camera
 * target, while the camera is within `labelMaxDistanceM`). A label never covers an icon, a
 * landmark name chip or another label. All quads in one mesh and one runtime atlas, drawn with
 * the name chips' unlit material settings, so they add no shader program.
 */
export const PinMarksConfigSchema = z.strictObject({
  iconPx: metres,
  labelPx: metres,
  labelGapPx: z.number().nonnegative(),
  iconCellPx: z.int().min(16).max(256),
  labelCellWidthPx: z.int().min(32).max(1024),
  labelCellHeightPx: z.int().min(16).max(256),
  atlasColumns: z.int().min(1).max(16),
  labelMaxChars: z.int().min(4).max(40),
  labelMaxDistanceM: metres,
  labelRadiusM: metres,
  maxLabels: z.int().min(0).max(32),
  /** How far, in pin heights, the icon sits in front of the pin's head (toward the camera). */
  pullToCamera: z.number().min(0).max(2),
  iconFontScale: ratio.max(1),
  labelFontScale: ratio.max(1),
  ringWidth: ratio.max(0.3),
  alphaTest: z.number().gt(0).lt(1),
})
export type PinMarksConfig = z.infer<typeof PinMarksConfigSchema>

/** How one kind of area name is drawn. */
const AreaLookSchema = z.strictObject({
  /** Letter height on the ground. */
  heightM: metres,
  /** Height above the water (water) or the land top (neighbourhoods). */
  liftM: z.number().nonnegative(),
  fill: TOKEN,
  /** The outline around each letter (null: none). */
  halo: TOKEN.nullable(),
  /** The outline's width as a share of the font size. */
  haloWidth: z.number().min(0).max(0.5),
})

/** What paves a plot's front yard (S04m): nothing (lawn), a plaza or a parking lot. */
export const PLOT_APRONS = ['none', 'plaza', 'parking'] as const
export type PlotApron = (typeof PLOT_APRONS)[number]

/** One category's plot: its building (a CC0 model with a recoloured facade) and dressing. */
const PlotStyleSchema = z
  .strictObject({
    /** The building model, or null for a plot without one (a station's square). */
    model: MODEL_ID.nullable(),
    /** The building's longer side in metres: the model is scaled uniformly to fit. */
    footprintM: z.number().nonnegative(),
    /** Theme world token of the facade (the model's `facade` slot), or null to keep it. */
    facade: TOKEN.nullable(),
    apron: z.enum(PLOT_APRONS),
    /** An awning across the building's front, its `canvas` slot in a theme token. */
    awning: z.strictObject({ model: MODEL_ID, color: TOKEN }).nullable(),
    trees: z.int().min(0).max(4),
    bushes: z.int().min(0).max(8),
  })
  .refine((style) => (style.model === null) === (style.footprintM === 0), {
    error: 'a plot with a building needs footprintM > 0, one without needs 0',
  })

/**
 * data/config/plots.json (S04m, DEC-59): every playable place and home stands on its own plot,
 * a square lawn with a kerb, its front yard paved as a plaza or a parking lot by category, and a
 * chunky, colourful CC0 building facing the camera, like the places of a game map. District
 * buildings and fill blocks keep clear of each plot (its square plus `clearM`). Colours are theme
 * world tokens; the server resolves them.
 */
export const PlotsConfigSchema = z.strictObject({
  /** The plot square's side. */
  plotM: metres,
  slabM: metres,
  /** The kerb ring around the lawn. */
  kerbM: metres,
  /** Extra clearance around the square where district buildings and blocks are removed. */
  clearM: z.number().nonnegative(),
  /** How far north of the place's point the building's centre stands (its front yard). */
  buildingBackM: z.number().nonnegative(),
  /** Buildings are squashed to this share of their fitted height: chunky, game-map proportions. */
  buildingHeightScale: ratio.max(1),
  /** A venue's pin (and its icon bubble) floats this far above its building's roof. */
  bubbleClearM: z.number().nonnegative(),
  /** Plots are merged into one mesh per square of this side (one draw call each). */
  chunkM: metres,
  lawn: TOKEN,
  kerb: TOKEN,
  aprons: z.strictObject({ plaza: TOKEN, parking: TOKEN }),
  /** Parking bay lines. */
  stripe: z.strictObject({ color: TOKEN, widthM: metres, lengthM: metres, gapM: metres }),
  /** The pack's dark roofs and trim, lightened (one baked colour to another). */
  roof: z.strictObject({ from: TOKEN, to: TOKEN }),
  trees: z.strictObject({ models: z.array(MODEL_ID).min(1), insetM: metres, scale: metres }),
  bush: z.strictObject({ model: MODEL_ID, scale: metres, spacingM: metres }),
  /**
   * The quality tiers that draw the plots' dressing: trees, bushes, awnings and parking-bay lines
   * (S41). Low leaves them out, like its
   * street props (perf.json `streetProps` caps trees at 0 on low), so a borough full of plots
   * stays inside the default view's `trianglesMax`.
   */
  dressingTiers: z
    .array(QualityTierSchema)
    .min(1)
    .refine((tiers) => new Set(tiers).size === tiers.length, { error: 'tiers must be unique' }),
  /** Per place category (a venue's type), plus `home`. */
  styles: z.record(MODEL_ID, PlotStyleSchema),
  /**
   * Big area names on the game map (data/places/areaLabels.json): water bodies painted on the
   * water, neighbourhoods floating just over the flattened background, like a game map's.
   */
  areas: z.strictObject({
    water: AreaLookSchema,
    neighborhood: AreaLookSchema,
    /** Atlas text height in pixels, and the gap between letters as a share of it. */
    fontPx: z.int().min(16).max(256),
    letterSpacing: z.number().min(0).max(1),
    alphaTest: z.number().gt(0).lt(1),
  }),
})

/**
 * data/config/compactLayout.json (S04n): where venues stand on the game map style, packed like a
 * game map's. Each cluster area's venues (a borough's or a neighbourhood zone's, `clusterBy`) are
 * laid on a square grid of `pitchM` around an anchor: the area's home, else a fixed venue (a
 * subway station, which stays at its station), else the point of the area that best trades
 * nearness to the nearest home (`pullToHome`) against nearness to the venues' own centre. Every
 * plot stays wholly inside its area, off parks, clear of the subway ribbons and landmark models,
 * and never overlaps another (the grid's gap between plots is the road). Homes, landmarks and
 * fixed venues never move. The server plans it (src/lib/world/compactLayout.ts) into the places
 * layer's `gx`/`gy`; the Real NYC style keeps every real position. Travel time, fares and
 * distances always use the real positions.
 */
export const CompactLayoutConfigSchema = z.strictObject({
  /**
   * What a cluster gathers (S04n2): every venue of a neighbourhood zone, or of a whole borough
   * (pulled in around the borough's home). Each plot stays wholly inside that area.
   */
  clusterBy: z.enum(['zone', 'borough']),
  /** Grid step between plot centres: the plot's side plus the road between two plots. */
  pitchM: metres,
  /** How many grid rings around the anchor are searched for a free slot. */
  maxRings: z.int().min(1).max(20),
  /** Venue categories that keep their real position (and anchor their zone's grid). */
  fixedCategories: z.array(MODEL_ID),
  /** How strongly an anchorless zone's grid is pulled toward the nearest home (1: all the way). */
  pullToHome: z.number().min(0).max(1),
  /** Spacing of the points an anchorless zone's anchor is chosen from. */
  anchorStepM: metres,
  /**
   * Venues gather around the anchor moved by this much (metres east, north), so the cluster
   * fills the default view, which frames its target high on the screen.
   */
  centreOffsetM: z.strictObject({ x: z.number(), y: z.number() }),
  /** Weight of the distance to the venue's real position against the distance to the anchor. */
  realBias: z.number().min(0).max(1),
  /** A plot centre keeps this far from every landmark's point. */
  landmarkClearM: z.number().nonnegative(),
  /** A plot centre keeps this far from every subway ribbon. */
  subwayClearM: z.number().nonnegative(),
  /** No plot corner (or centre) on a park, cemetery or other park-layer area. */
  avoidParks: z.boolean(),
})
export type CompactLayoutConfig = z.infer<typeof CompactLayoutConfigSchema>

export const AREA_KINDS = ['water', 'neighborhood'] as const

/** data/places/areaLabels.json: the game map's area names (S04m); text is copy (`map.area.*`). */
export const AreaLabelsFileSchema = z.strictObject({
  labels: z
    .array(
      z.strictObject({
        id: MODEL_ID,
        kind: z.enum(AREA_KINDS),
        nameKey: z.string().regex(/^map\.area\.[a-zA-Z]+$/),
        location: z.strictObject({
          lat: z.number().min(40.4).max(41),
          lng: z.number().min(-74.3).max(-73.6),
        }),
        /** Text direction, counter-clockwise from east (along a river). */
        angleDeg: z.number().min(-90).max(90),
      }),
    )
    .min(1),
})
export type PlotsConfig = z.infer<typeof PlotsConfigSchema>

/**
 * What the city's 3D chunk reads: the scene config without the blocks other code reads itself
 * (the apartment chunk imports its own, the look runtime its derived file; the fallback map is
 * drawn on the server), so they never
 * travel with the page.
 */
export type CitySceneConfig = Omit<SceneConfig, 'apartment' | 'fallback' | 'avatarLook'>

export function citySceneConfig(scene: SceneConfig): CitySceneConfig {
  const city: Partial<SceneConfig> = { ...scene }
  delete city.apartment
  delete city.fallback
  // The look runtime reads its block from data/avatar/scene.derived.json, in its lazy chunk.
  delete city.avatarLook
  return city as CitySceneConfig
}
