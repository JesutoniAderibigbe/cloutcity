/**
 * Shared types of the living city (S04l, DEC-52): the pure ambient simulation in this folder
 * (vehicles, pedestrians, trains, traffic lights; no three, no React, no clock) and the kits the
 * runtime (src/scene/ambient/) draws them with.
 *
 * Kit types are generic over the geometry type `G` so this folder stays three-free: the scene
 * instantiates them with three's `BufferGeometry`.
 *
 * Coordinates are local metres (x east, y north, src/lib/geo/projection.ts). `yaw` is the
 * scene's rotation about +y that turns a model's +z axis (its length, nose forward) to the
 * direction of travel: yaw = atan2(dx, -dy), the convention of src/lib/world/streetProps.ts.
 */

export type AmbientTier = 'low' | 'mid' | 'high'

/** A per-tier value, as data/config/ambient.json writes them. */
export type PerAmbientTier<T> = Readonly<Record<AmbientTier, T>>

export interface Circle {
  readonly x: number
  readonly y: number
  readonly r: number
}

// ---- simulation output -----------------------------------------------------------------------

/**
 * Where one ambient instance stands at a time. Mutable and reused: the sim writes into a pose the
 * caller owns, so a tick allocates nothing.
 */
export interface AmbientPose {
  x: number
  y: number
  /** Rotation about +y (see the file comment). */
  yaw: number
  /**
   * 0..1 spawn/despawn fade (a car pulling in or out of the parking lane, a pedestrian stepping
   * out of a door, a train near a memorial). The runtime multiplies its size by it: there is no
   * transparency, so a fade is a scale.
   */
  scale: number
  /** 0..1 how present it is; 0 means "not drawn" (inactive slot, outside its epoch, faded). */
  alpha: number
  /** Metres above the ground: a pedestrian's walking bob. 0 for vehicles and trains. */
  lift: number
  /** Metres per second right now (0 while waiting at a red light or dwelling at a station). */
  speed: number
}

export const createPose = (): AmbientPose => ({
  x: 0,
  y: 0,
  yaw: 0,
  scale: 0,
  alpha: 0,
  lift: 0,
  speed: 0,
})

// ---- street graph ----------------------------------------------------------------------------

/** A traffic signal at a junction of `lights.minEnds` or more street ends. */
export interface Signal {
  /** Seconds into the cycle at t = 0 (from the junction's hash). */
  readonly offsetS: number
  /** Unit direction of the junction's first street: approaches along it share a phase. */
  readonly axisX: number
  readonly axisY: number
}

/** One end of an edge meeting a node. */
export interface NodeEnd {
  readonly edge: number
  /** True when the edge starts here (leaving the node walks it forwards). */
  readonly atStart: boolean
}

export interface StreetNode {
  /** `${x},${y}` of its integer point. */
  readonly key: string
  readonly x: number
  readonly y: number
  readonly ends: readonly NodeEnd[]
  readonly signal: Signal | null
}

/** A stretch of one LION chain between two nodes (junctions or chain ends). */
export interface StreetEdge {
  /** Index into the decoded chains (src/lib/world/streetProps.ts decodeStreets). */
  readonly chain: number
  readonly from: number
  readonly to: number
  /** Its vertices, `from` node first. */
  readonly points: readonly { readonly x: number; readonly y: number }[]
  readonly lengthM: number
  readonly halfWidthM: number
  /** STREET_FLAGS bits (parkLeft 1, parkRight 2, wide 4). */
  readonly flags: number
  /** Inside a pedestrian memorial clearance (`pedestrians.lookOnlyMarginM`): never walked. */
  readonly nearMemorial: boolean
}

export interface StreetGraph {
  readonly nodes: readonly StreetNode[]
  readonly edges: readonly StreetEdge[]
  /** `cellM` squares (key `cellKey(cx, cy)`, graph.ts) to the edges whose midpoint lies inside. */
  readonly cells: ReadonlyMap<number, readonly number[]>
  readonly cellM: number
}

// ---- ambient config (data/config/ambient.json; zod AmbientConfigSchema) ----------------------

export interface LightsConfig {
  readonly cycleS: number
  /** Share of the cycle each axis is green; the rest is all-red. */
  readonly greenShare: number
  /** Metres a car stops before the cross street's kerb. */
  readonly stopGapM: number
  /** Metres between queued cars. */
  readonly queueGapM: number
  /** |cos| of the angle to the signal axis at or above which an approach rides that axis. */
  readonly axisCos: number
  /** Street ends a junction needs to carry a signal. */
  readonly minEnds: number
}

export interface DistanceScale {
  /** Size multiplier per metre of camera distance. */
  readonly perDistance: number
  /** Never larger than this; never smaller than 1 (real size). */
  readonly max: number
}

export interface VehiclesConfig {
  readonly models: PerAmbientTier<readonly string[]>
  /** Share of cars that are taxis where the tier has a taxi model. */
  readonly taxiShare: number
  /** Share of slots on wide streets that are buses where the tier has a bus model. */
  readonly busShare: number
  readonly busWideOnly: boolean
  readonly perCell: PerAmbientTier<number>
  /**
   * Speed belongs to the street (so no car drives through another on its lane): `min` on
   * ordinary streets, `max` on wide ones.
   */
  readonly speedMps: { readonly min: number; readonly max: number }
  /** Lane centre = max(minLaneOffsetM, halfWidth × laneOffsetRatio) right of the centreline. */
  readonly laneOffsetRatio: number
  readonly minLaneOffsetM: number
  readonly epochS: number
  readonly cohorts: number
  readonly fadeS: number
  /** Seconds a car takes to brake to a stop line (and to pull away again). */
  readonly brakeS: number
  /** Nose-to-nose spacing a queued car keeps (its length plus `lights.queueGapM`). */
  readonly lengthM: number
  readonly showBelowDistanceM: PerAmbientTier<number>
  readonly scale: DistanceScale
  /** theme-free paint colours (sRGB hex) drawn per instance; taxis keep their own paint. */
  readonly paint: readonly string[]
}

export interface PedestriansConfig {
  readonly source: 's16b'
  readonly anchors: readonly AnchorKind[]
  readonly anchorRadiusM: number
  readonly perAnchor: PerAmbientTier<number>
  readonly speedMps: { readonly min: number; readonly max: number }
  /** Sidewalk centre = street half-width + this, ± jitter. */
  readonly sidewalkOffsetM: number
  readonly sidewalkJitterM: number
  readonly epochS: number
  readonly fadeS: number
  readonly showBelowDistanceM: PerAmbientTier<number>
  readonly scale: DistanceScale
  readonly bobM: number
  readonly bobHz: number
  /** Kept this far beyond a memorial's clearance radius; a memorial is never an anchor. */
  readonly lookOnlyMarginM: number
  readonly palette: {
    readonly skin: readonly string[]
    readonly tops: readonly string[]
    readonly bottoms: readonly string[]
  }
}

export interface TrainsConfig {
  readonly speedMps: number
  readonly dwellS: number
  readonly headwayS: number
  readonly cars: PerAmbientTier<number>
  /** A car's real size (the runtime scales it up with distance like the trip's train). */
  readonly carLengthM: number
  readonly carWidthM: number
  readonly carHeightM: number
  /** Gap between cars as a share of a car's length. */
  readonly gapRatio: number
  /** A station counts as a stop of a line path within this many metres of it. */
  readonly stationSnapM: number
  /** Stops closer than this along a path merge into one. */
  readonly minStopGapM: number
  /** Hidden within this many metres of a memorial pin (a line under the memorial). */
  readonly lookOnlyMarginM: number
  /** The last metres before `lookOnlyMarginM` fade the cars out. */
  readonly lookOnlyFadeM: number
}

export interface DensityConfig {
  /** Share of slots active at each step-down level (level 0 first). */
  readonly steps: readonly number[]
  /** Multiplier on the share at night (personal game clock). */
  readonly night: number
}

export type TownsfolkPose = 'idle' | 'talk' | 'wave' | 'walk'

/** ambient.json `townsfolk` (S04o, schemas/scene.ts TownsfolkConfigSchema documents each field). */
export interface TownsfolkConfig {
  readonly perVenue: PerAmbientTier<number>
  readonly maxShown: PerAmbientTier<number>
  readonly focusRadiusM: PerAmbientTier<number>
  readonly showBelowDistanceM: PerAmbientTier<number>
  readonly fadeShare: number
  readonly heightOfPlayer: number
  readonly frontM: number
  readonly spacingOfHeight: number
  readonly minRingOfHeight: number
  readonly epochS: number
  readonly walkHeightsPerS: number
  readonly easeS: number
  readonly turnS: number
  readonly turnLookOfHeight: number
  readonly sidewalkOfHeight: number
  readonly maxDetour: number
  readonly accessM: number
  readonly maxWalkShare: number
  readonly neighbours: number
  readonly homeShare: number
  readonly poses: PerAmbientTier<readonly TownsfolkPose[]>
  readonly poseShare: { readonly talk: number; readonly wave: number }
  readonly frames: { readonly walk: PerAmbientTier<number>; readonly stand: PerAmbientTier<number> }
  readonly phaseGroups: PerAmbientTier<number>
  readonly faceJitterRad: number
  readonly hair: readonly string[]
  readonly names: {
    readonly woman: readonly string[]
    readonly man: readonly string[]
    readonly initials: string
  }
  readonly vibes: readonly string[]
}

/** One aircraft route of ambient.json `planes.routes` (S04q, schemas/scene.ts documents it). */
export interface PlaneRouteConfig {
  readonly id: string
  readonly kind: 'arrival' | 'departure' | 'overflight' | 'helicopter'
  /** Waypoints: [longitude, latitude, map altitude in metres]. */
  readonly points: readonly (readonly [number, number, number])[]
  readonly headwayS: number
  readonly offsetS: number
  readonly closed: boolean
}

/** ambient.json `planes` (S04q). */
export interface PlanesConfig {
  readonly maxShown: PerAmbientTier<number>
  readonly helicopters: PerAmbientTier<number>
  readonly speedMps: number
  readonly lengthM: number
  readonly scale: DistanceScale
  readonly samplesPerSpan: number
  readonly lookM: number
  readonly bankGain: number
  readonly maxBankRad: number
  readonly fadeS: number
  readonly helicopter: {
    readonly speedMps: number
    readonly lengthM: number
    readonly rotorHz: number
  }
  readonly lights: {
    readonly strobePeriodS: number
    readonly strobeOnS: number
    readonly beaconPeriodS: number
    readonly navM: number
  }
  readonly colors: {
    readonly body: string
    readonly accent: string
    readonly helicopter: string
    readonly lamp: string
    readonly red: string
    readonly green: string
    readonly white: string
  }
  readonly routes: readonly PlaneRouteConfig[]
  readonly passing: {
    readonly cellM: number
    readonly headwayS: number
    readonly lengthM: number
    /** Lowest and highest map altitude over a passing line. */
    readonly altM: readonly [number, number]
    /** Share of a square the line's middle may stray from its centre. */
    readonly jitter: number
    readonly headingJitterRad: number
    /** [longitude, latitude] of each airport the flows lead to. */
    readonly airports: readonly (readonly [number, number])[]
  }
}

export interface AmbientConfig {
  readonly seed: number
  readonly cellM: number
  readonly fpsCap: PerAmbientTier<number>
  readonly focusRadiusM: PerAmbientTier<number>
  readonly density: DensityConfig
  readonly stepDown: { readonly belowFps: PerAmbientTier<number> }
  readonly lights: LightsConfig
  readonly vehicles: VehiclesConfig
  readonly pedestrians: PedestriansConfig
  readonly trains: TrainsConfig
  /** Kit baking thresholds (data/config ambient.json `vehicleKit`, schemas/ambientKit.ts). */
  readonly vehicleKit: {
    readonly light: {
      readonly warmMinRed: number
      readonly warmMaxBlueShare: number
      readonly tailMinRed: number
      readonly tailMaxGreenShare: number
    }
    /** Night lamps (schemas/ambientKit.ts `lamps`, S04p). */
    readonly lamps: {
      readonly widthShare: number
      readonly heightShare: number
      readonly depthM: number
      readonly insetM: number
      readonly xShare: number
      readonly yShare: number
      readonly head: string
      readonly tail: string
      readonly nightGlow: number
    }
  }
  readonly townsfolk: TownsfolkConfig
  readonly planes: PlanesConfig
}

// ---- simulation inputs -----------------------------------------------------------------------

export type AnchorKind = 'place' | 'home' | 'landmark'

/** Where pedestrians gather: a place pin, a home or a (non-memorial) landmark. */
export interface PedestrianAnchor {
  readonly id: string
  readonly kind: AnchorKind
  readonly x: number
  readonly y: number
}

/** A subway line path for the trains (base geo, decoded). */
export interface TrainLine {
  readonly id: string
  /** sRGB hex of the line's ribbon colour: the train's per-instance colour. */
  readonly color: string
  readonly paths: readonly (readonly { readonly x: number; readonly y: number }[])[]
}

export interface TrainStation {
  readonly x: number
  readonly y: number
  readonly lines: readonly string[]
}

// ---- kits (S04l part B, src/scene/ambient/{vehicleKits,pedestrianKits,buckets}.ts) ------------

/**
 * Colour buckets. Each kit is split by colour into parts, one InstancedMesh per part on the
 * blocks' instanced toon material (per-instance colour, no vertex colours): zero new programs.
 *
 * Vehicles: `paint` takes the instance's paint (a taxi keeps its part colour), `glass` the dark
 * windows, tyres and trim, `light` head and tail lights.
 * Pedestrians: `skin`, `top`, `bottom` take the instance's palette pick; `accent` (hair, shoes)
 * keeps its part colour.
 */
export const VEHICLE_BUCKETS = ['paint', 'glass', 'light'] as const
export type VehicleBucket = (typeof VEHICLE_BUCKETS)[number]
export const PEDESTRIAN_BUCKETS = ['skin', 'top', 'bottom', 'accent'] as const
export type PedestrianBucket = (typeof PEDESTRIAN_BUCKETS)[number]

export interface KitPart<B extends string, G> {
  readonly bucket: B
  /** Indexed or not; positions and normals only (no vertex colours, no UVs needed). */
  readonly geometry: G
  /** sRGB hex of the part's own colour (what a bucket not recoloured per instance draws). */
  readonly color: string
}

export type VehicleKind = 'car' | 'taxi' | 'bus'

/**
 * One ambient vehicle model, real size, in model space: centred on x, wheels on y = 0, nose
 * towards +z.
 */
export interface VehicleKit<G> {
  /** Catalog id (`sedan-ambient`, `taxi-ambient`, `hatchback-ambient`, `bus-ambient`). */
  readonly id: string
  readonly kind: VehicleKind
  readonly parts: readonly KitPart<VehicleBucket, G>[]
  readonly lengthM: number
  readonly widthM: number
  readonly heightM: number
  /** Triangles of one instance, all parts. */
  readonly triangles: number
  dispose(): void
}

/** One ambient pedestrian, baked rigid mid-stride, real size, feet on y = 0, facing +z. */
export interface PedestrianKit<G> {
  readonly id: string
  readonly parts: readonly KitPart<PedestrianBucket, G>[]
  readonly heightM: number
  readonly triangles: number
  dispose(): void
}

/**
 * The S16b seam: where pedestrian kits come from (`pedestrians.source` in ambient.json; S16b's
 * merged `npc-*` models today). `L` is the models runtime's loader the source may use.
 */
export type PedestrianKitSource<G, L> = (
  tier: AmbientTier,
  loadModels: L,
) => Promise<PedestrianKit<G>[]>

/** The same seam for vehicles: kits for a tier's `vehicles.models` ids. */
export type VehicleKitSource<G, L> = (
  tier: AmbientTier,
  ids: readonly string[],
  loadModels: L,
) => Promise<VehicleKit<G>[]>
