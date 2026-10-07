/**
 * Schema for data/config/scene.json: the 3D city's camera rig, layer heights and render sizes.
 * Distances are metres (1 scene unit = 1 m), angles degrees, widths CSS pixels. Colours are not
 * here: they are palette tokens in data/config/theme.json (`scene`).
 */
import { z } from 'zod'

const metres = z.number().positive()
const ratio = z.number().positive()

/** A default angle and the range the player may move it within. */
const AngleRangeSchema = z
  .strictObject({ default: z.number(), min: z.number(), max: z.number() })
  .refine((angle) => angle.min <= angle.default && angle.default <= angle.max, {
    error: 'default must lie within min..max',
  })

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
    ambientIntensity: z.number().nonnegative(),
    sunIntensity: z.number().nonnegative(),
    /** Towards the sun, in scene axes (x east, y up, z south). */
    sunDirection: z
      .strictObject({ x: z.number(), y: z.number(), z: z.number() })
      .refine((d) => d.y > 0, { error: 'the sun must be above the horizon' }),
  }),
  /** "Expanding soon" land and parks (S04c): their colour mixed this far towards the background. */
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
    })
    .refine((p) => p.minHeightM <= p.maxHeightM, {
      error: 'minHeightM must not exceed maxHeightM',
    }),
  /** The camera move to a place picked outside the map (the Places panel, a hook). */
  focus: z.strictObject({
    tweenMs: z.int().nonnegative(),
    /** The camera ends at most this far from the place. */
    maxDistanceM: metres,
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
})
export type SceneConfig = z.infer<typeof SceneConfigSchema>
