/**
 * Schemas for venue interiors (S43): the 3D inside views a place sheet shows behind it.
 *
 * - data/interiors/venues/<id>.json: each interior's layout (a room shell like an apartment's, from
 *   the same finishes), its catalog furniture and code-built pieces (bars, stools, DJ booth), the
 *   glowing parts and how they animate, the dance floor, party lights, string lights and skyline,
 *   its music mood and lighting, where the player's Sim acts out each place action, and where
 *   the locals stand, dance and sit and how busy each hour is. One file per interior, so
 *   each loads in its own small lazy chunk (S43b). Which venue types (data/venues/venues.json
 *   `type`), and which single venues, open which interior is data/interiors/types.json.
 * - data/interiors/sim.json: the poses, props and hands every interior adds to the room Sim's.
 * - data/config/interiors.json: the per-tier caps (draw calls, triangles) and crowd sizes, the
 *   locals' poses, frames and colours, and the lights' tier counts.
 *
 * Only the data tests import this module: the interior's lazy chunk reads the raw JSON and
 * narrows it (src/scene/venue/data.ts), so classic zod never ships to the browser for it.
 */
import { z } from 'zod'
import { QUALITY_TIERS } from './config'
import { CopyKeyRefSchema, IdSchema } from './content'

const point = z.tuple([z.number(), z.number(), z.number()])
const point2 = z.tuple([z.number(), z.number()])
const positive = z.number().positive()
const nonNegative = z.number().nonnegative()
const share = z.number().min(0).max(1)
const degrees = z.number().min(-360).max(360)
const turn = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
const SLOT_ID = /^f\d+-\d+$/
const slot = z.string().regex(SLOT_ID, 'a floor cell f<c>-<r>')
/** A palette token (theme.json `colors`, `world` or `models`). */
const token = z.string().regex(/^[a-z]+-\d{2,3}$/)
const hex = z.string().regex(/^#[0-9a-f]{6}$/i)

function perTier<T extends z.ZodType>(value: T) {
  return z.strictObject(
    Object.fromEntries(QUALITY_TIERS.map((tier) => [tier, value])) as Record<
      (typeof QUALITY_TIERS)[number],
      T
    >,
  )
}

/**
 * How a part glows (drawn in the interior's one instanced glow mesh): `steady` always lit,
 * `beat` cycling through the palette on the music's beat while the venue is open, `night` lit
 * by the night glow (string lights, a lit doorway).
 */
const GlowSchema = z.enum(['steady', 'beat', 'night'])

const PartSchema = z.strictObject({
  shape: z.enum(['box', 'disc']),
  /** Width, height and depth in metres (a disc's width and depth are its diameters). */
  size: z.tuple([positive, positive, positive]),
  /** Its centre: room metres for `build`, the cell's own frame for a kind's parts. */
  at: point,
  token,
  glow: GlowSchema.optional(),
  /** Copies along a step (a shelf of bottles), and rows of those copies. */
  repeat: z.strictObject({ count: z.int().min(1), step: point }).optional(),
  rows: z.strictObject({ count: z.int().min(1), step: point }).optional(),
  /** Colours the copies take in turn (glowing bottles), instead of `token`. */
  tokens: z.array(token).min(1).optional(),
})

const AnchorSchema = z.strictObject({
  pose: IdSchema,
  /** Where the body rests, in metres in the piece's frame at turn 0. */
  at: point,
  headingDeg: degrees,
  approach: z.array(point).min(1),
})

const KindSchema = z.strictObject({
  parts: z.array(PartSchema).min(1),
  /** Where a Sim sits on it (a stool): the room Sim's anchors (data/homes/interactions.json). */
  anchors: z.array(AnchorSchema),
})

const PieceSchema = z.strictObject({
  kind: IdSchema,
  slot,
  turn,
  /** Moves the piece off its cell's centre (a table between two cells), in metres. */
  offset: point.optional(),
})

const DecorSchema = z.strictObject({
  id: IdSchema,
  /** A decor item with a 3D look (data/items, scene.json `models.decor`). */
  item: IdSchema,
  slot,
  turn,
  footprint: z.enum(['1x1', '2x1', '2x2']),
  /** Its colour variant: a palette token (theme.json `colors`). */
  token,
})

const StepSchema = z.strictObject({
  poses: z.array(IdSchema).min(1),
  /** Furniture models used, best first; none uses the interior's `simSpots`. */
  models: z.array(IdSchema),
  holdMs: z.int().positive(),
  optional: z.boolean().optional(),
  prop: IdSchema.optional(),
  propAt: z.enum(['anchor', 'hands']).optional(),
  bubble: CopyKeyRefSchema.optional(),
})

const CrowdSpotSchema = z.strictObject({
  /** What a local here is doing (the real players' activities match these, S43). */
  activity: IdSchema,
  /** The local's pose (data/config/interiors.json `crowd.clips`). */
  pose: IdSchema,
  /** Floor point in room metres (x right, z toward the open front). */
  at: point2,
  headingDeg: degrees,
  /** Lower ranks fill first: a quiet hour still has its DJ and a few dancers. */
  rank: z.int().nonnegative(),
  /** Staff (the DJ, the bartender) are there whenever the venue is open. */
  staff: z.boolean().optional(),
})

/** Locals also sit on the interior's seats: its pieces of a kind, or its decor of a model. */
const CrowdSeatSchema = z
  .strictObject({
    activity: IdSchema,
    kind: IdSchema.optional(),
    model: IdSchema.optional(),
    rank: z.int().nonnegative(),
  })
  .refine((seat) => (seat.kind === undefined) !== (seat.model === undefined), {
    message: 'a seat names a piece kind or a furniture model, not both',
  })

export const InteriorSchema = z.strictObject({
  grid: z.strictObject({ cols: z.int().min(2), rows: z.int().min(2), cellM: positive }),
  heightM: positive,
  openings: z.array(
    z.strictObject({
      kind: z.enum(['window', 'door']),
      wall: z.enum(['back', 'left', 'right']),
      at: z.int().nonnegative(),
      span: z.int().positive(),
      sillM: nonNegative,
      heightM: positive,
    }),
  ),
  camera: z.strictObject({ position: point, target: point, fovDeg: positive }),
  /** Where the player's Sim stands when the interior opens. */
  entry: z.strictObject({ slot, rotationDeg: degrees }),
  /** The shell's finishes (data/homes/finishes.json), as an apartment's. */
  shell: z.strictObject({
    wallPaint: IdSchema,
    floorFinish: IdSchema,
    crown: z.boolean(),
    accentBack: IdSchema.nullable(),
  }),
  /** Behind the room: the theme's room backdrop tinted, or the sky of the clock (a rooftop). */
  backdrop: z.strictObject({ kind: z.enum(['room', 'sky']), tint: token.nullable() }),
  mood: z.strictObject({
    /** The music mood (for the audio layer): an id, never a track. */
    music: IdSchema,
    /** The beat the lights and the dance follow. */
    bpm: positive,
    /** Light colour mixed into the ambient while the venue is open. */
    tint: token,
    openMix: share,
    openAmbientScale: positive,
    openSunScale: nonNegative,
    closedAmbientScale: positive,
  }),
  decor: z.array(DecorSchema),
  /** Catalog models standing on a cell (the speakers), drawn as the apartment's fixtures. */
  fixtures: z.array(z.strictObject({ model: IdSchema, slot, turn })),
  kinds: z.record(IdSchema, KindSchema),
  pieces: z.array(PieceSchema),
  /** One-off code-built parts in room metres (the bar, the DJ booth). */
  build: z.array(PartSchema),
  /** Floor cells `build` covers: the Sim walks around them. */
  blocked: z.array(slot),
  danceFloor: z
    .strictObject({
      slot,
      cols: z.int().positive(),
      rows: z.int().positive(),
      tilesPerCell: z.int().positive(),
      liftM: positive,
      gapShare: z.number().min(0).max(0.4),
      tokens: z.array(token).min(2),
      /** The tiles' colour while the venue is closed. */
      dim: token,
    })
    .nullable(),
  partyLights: z
    .strictObject({
      heads: z.array(point).min(1),
      /** Where the beams point at rest. */
      aim: point,
      beamLengthM: positive,
      beamRadiusM: positive,
      beamOpacity: share,
      swingDeg: nonNegative,
      tokens: z.array(token).min(1),
      ball: z.strictObject({ at: point, radiusM: positive, token }).nullable(),
    })
    .nullable(),
  stringLights: z
    .strictObject({
      /** Pole feet (x, z) in room metres. */
      poles: z.array(point2).min(2),
      /** Pairs of pole indices a strand hangs between. */
      strands: z.array(point2).min(1),
      topM: positive,
      sagM: nonNegative,
      bulbSpacingM: positive,
      bulbM: positive,
      wireToken: token,
      bulbToken: token,
      /** A bulb's colour by day (unlit). */
      dayToken: token,
    })
    .nullable(),
  skyline: z
    .strictObject({
      seed: z.int(),
      count: z.int().positive(),
      sides: z.array(z.enum(['back', 'left', 'right'])).min(1),
      /** How far beyond the walls the towers stand, and their sizes. */
      gapM: point2,
      heightM: point2,
      widthM: point2,
      /** Where the towers' feet are (below the deck, out of view). */
      baseM: z.number(),
      tokens: z.array(token).min(1),
      capToken: token,
      windowToken: token,
      windowDayToken: token,
      windowRows: z.int().positive(),
      windowCols: z.int().positive(),
    })
    .nullable(),
  /** Spots for the player's Sim (a pose with no furniture: the dance floor, a selfie spot). */
  simSpots: z.array(
    z.strictObject({ pose: IdSchema, slot, rotationDeg: degrees, heightM: nonNegative }),
  ),
  /** Each place action the venue offers, as the steps the player's Sim acts out. */
  actions: z.record(IdSchema, z.array(StepSchema).min(1)),
  crowd: z.strictObject({
    /**
     * The locals' poses, most important first: a tier bakes the clips of the first poses up to
     * its `clipsMax` (data/config/interiors.json), so a low-end phone still shows the barbers
     * cutting before the people waiting.
     */
    poses: z.array(IdSchema).min(1),
    spots: z.array(CrowdSpotSchema).min(1),
    seats: z.array(CrowdSeatSchema),
    /** How busy each opening hour is (0–23, share of the tier's crowd). */
    hours: z.array(z.tuple([z.int().min(0).max(23), share])).min(1),
    /** Days of the week (1-based, the clock's `dayOfWeek`) at full crowd. */
    busyDays: z.array(z.int().min(1)),
    /** The crowd's share on other nights. */
    quietShare: share,
  }),
})
export type InteriorData = z.infer<typeof InteriorSchema>

/** data/interiors/sim.json: what every interior adds to the room Sim (data/config/roomSim.json). */
export const InteriorSimFileSchema = z.strictObject({
  sim: z.strictObject({
    poses: z.record(
      IdSchema,
      z.strictObject({ clip: IdSchema, contactRigUnits: point, tiltDeg: degrees }),
    ),
    props: z.record(
      IdSchema,
      z.strictObject({
        parts: z
          .array(
            z.strictObject({
              shape: z.enum(['box', 'disc']),
              size: z.tuple([positive, positive, positive]),
              at: point,
              token: z.string().regex(/^[a-z]+-\d{3}$/),
            }),
          )
          .min(1),
      }),
    ),
    hands: z.record(IdSchema, point),
    /** The player's dance: a bob and sway over a held clip (src/scene/apartment/sim/SimAvatar). */
    groove: z.strictObject({ clip: IdSchema, bobM: nonNegative, swayDeg: nonNegative }),
  }),
})
export type InteriorSimFile = z.infer<typeof InteriorSimFileSchema>

/**
 * data/interiors/types.json: venue type → interior id, the types whose sheet shows an inside
 * view, and single venues that open another interior than their type's (the boxing gym, the
 * warehouse, the dispatch depot). Its own small file: the place sheet's chunk reads it to know
 * whether to load an interior.
 */
export const InteriorTypesFileSchema = z.strictObject({
  byVenueType: z.record(IdSchema, IdSchema),
  byVenue: z.record(IdSchema, IdSchema),
})

export const InteriorsConfigSchema = z.strictObject({
  caps: z.strictObject({
    /** Draw calls and triangles of an interior's frame, its avatar and locals included. */
    drawCallsMax: perTier(z.int().positive()),
    trianglesMax: perTier(z.int().positive()),
    /** Kept free for each real player drawn inside (their avatar). */
    occupantReserve: z.strictObject({
      drawCalls: z.int().nonnegative(),
      triangles: z.int().nonnegative(),
    }),
  }),
  crowd: z.strictObject({
    /** Locals at a full hour. */
    max: perTier(z.int().nonnegative()),
    /** Bodies (woman, man) a tier draws: each body and clip costs four draw calls. */
    bodies: perTier(z.int().min(1).max(2)),
    /** The most clips a tier bakes for one interior (its first poses' clips, S43b). */
    clipsMax: perTier(z.int().min(1)),
    /** The rig clip each pose loops. */
    clips: z.record(IdSchema, z.enum(['idle', 'talk', 'wave', 'walk', 'sit', 'interact', 'run'])),
    /** Baked frames per loop. */
    frames: perTier(z.int().min(2)),
    heightM: z.strictObject({ min: positive, max: positive }),
    /** Where a sitter's seat is in a `sit` frame: up the body, and behind its origin. */
    sit: z.strictObject({ seatShare: share, backShare: z.number().min(-0.5).max(0.5) }),
    jitterM: nonNegative,
    headingJitterDeg: nonNegative,
    groove: z.strictObject({ bobM: nonNegative, swayDeg: nonNegative }),
    /**
     * Poses that move on top of their loop like the dance's groove (a rep, a boxer's bounce):
     * a bob of `bobM` `perBeat` times a beat, swaying `swayDeg` either way.
     */
    moves: z.record(
      IdSchema,
      z.strictObject({ bobM: nonNegative, swayDeg: nonNegative, perBeat: positive }),
    ),
    palette: z.strictObject({
      skin: z.array(hex).min(1),
      tops: z.array(hex).min(1),
      bottoms: z.array(hex).min(1),
      accents: z.array(hex).min(1),
    }),
  }),
  /** Real players drawn inside at once (S43 hook; each costs `occupantReserve`). */
  occupants: z.strictObject({ max: perTier(z.int().nonnegative()) }),
  lights: z.strictObject({
    /** Party light beams drawn (transparent cones: fill rate). */
    beams: perTier(z.int().nonnegative()),
    /** Beats between dance floor and panel colour steps. */
    tileBeats: positive,
    panelBeats: positive,
    /** How bright `beat` parts stay while the venue is closed. */
    closedGlow: share,
  }),
})
export type InteriorsConfig = z.infer<typeof InteriorsConfigSchema>
