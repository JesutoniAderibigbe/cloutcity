/**
 * Schemas for the Sim acting out home actions in the 3D room (S40c):
 * - data/config/roomSim.json: how the Sim walks (speed, turn rate, the walk clip's stride so the
 *   feet never slide), the poses it takes (a rig clip, where its body meets a seat or mattress,
 *   a tilt for lying down), the props it uses, and each home action as steps (sit to eat after
 *   cooking, say). Visual only: the engine's timer and stat effects never read it.
 * - data/homes/interactions.json: where a Sim uses each furniture model (its seat, its mattress,
 *   the spot in front of the stove: position, facing, pose and the floor points it walks to
 *   first), in the item's own frame, and per home the fallback spots for a pose the room's
 *   furniture cannot give.
 *
 * Only the data tests import this module: the room's lazy chunk reads the raw JSON and narrows
 * it, so classic zod never ships to the browser for it.
 */
import { z } from 'zod'
import { HOME_IDS } from '../homes'
import { CopyKeyRefSchema, IdSchema } from './content'

const point = z.tuple([z.number(), z.number(), z.number()])
const positive = z.number().positive()
const nonNegative = z.number().nonnegative()
const degrees = z.number().min(-180).max(180)
const SLOT_ID = /^f\d+-\d+$/

const PoseSchema = z.strictObject({
  /** The rig clip held in this pose (data/assets/manifest.json `clips`). */
  clip: IdSchema,
  /**
   * Where the body rests on a seat or mattress, in the rig's own units from the avatar's feet
   * (the root): the anchor's `at` is placed here, so the clip's own pose sits on the furniture.
   */
  contactRigUnits: point,
  /** The body's tilt about its own left-right axis: -90 lies it on its back, head forward. */
  tiltDeg: degrees,
})

const PropPartSchema = z.strictObject({
  shape: z.enum(['box', 'disc']),
  /** Width, height and depth in metres. */
  size: z.tuple([positive, positive, positive]),
  at: point,
  /** A palette token (theme.json `colors`). */
  token: z.string().regex(/^[a-z]+-\d{3}$/),
})

const StepSchema = z.strictObject({
  /** The poses that do this step, best first (a seat to eat on, else standing at a table). */
  poses: z.array(IdSchema).min(1),
  /** The furniture models used, best first; a step with none uses the home's spots. */
  models: z.array(IdSchema).min(1),
  /** How long the Sim stays in the pose, in real milliseconds. */
  holdMs: z.int().positive(),
  /** A step the room can skip when it has no such furniture (the fridge before cooking). */
  optional: z.boolean().optional(),
  prop: IdSchema.optional(),
  /** Where the prop shows: at the anchor's `prop` point (a pan on the hob) or in the hands. */
  propAt: z.enum(['anchor', 'hands']).optional(),
  /** Copy key of the bubble shown over the Sim's head while it holds the pose ("Zzz"). */
  bubble: CopyKeyRefSchema.optional(),
})

export const RoomSimConfigSchema = z.strictObject({
  walk: z.strictObject({
    speedMps: positive,
    accelMps2: positive,
    turnDegPerS: positive,
    /** How far the walk clip carries the body in one loop, in rig units (its planted foot). */
    strideRigUnits: positive,
    /** The walk clip never plays slower than this share, so the Sim never moonwalks to a stop. */
    minTimeScale: z.number().gt(0).max(1),
    /** How far a walking Sim keeps from furniture and walls. */
    clearanceM: nonNegative,
    /** A floor tap closer than this to a wall is pulled back inside the room. */
    edgeM: nonNegative,
  }),
  /** Clip cross-fade. */
  fadeS: nonNegative,
  /** Getting into a pose (sitting down, lying down) and back out of it. */
  enterS: nonNegative,
  exitS: nonNegative,
  poses: z.record(IdSchema, PoseSchema),
  props: z.record(IdSchema, z.strictObject({ parts: z.array(PropPartSchema).min(1) })),
  /** Each home action (balance.json `place.homeActions`) as the steps the Sim acts out. */
  actions: z.record(IdSchema, z.array(StepSchema).min(1)),
  /** An action without steps here: the Sim stands where it is for a moment. */
  fallback: z.strictObject({ poses: z.array(IdSchema).min(1), holdMs: z.int().positive() }),
  /** Where a held prop sits for a pose, in rig units from the feet. */
  hands: z.record(IdSchema, point),
  bubble: z.strictObject({ aboveHeadM: nonNegative, joint: IdSchema }),
})
export type RoomSimConfig = z.infer<typeof RoomSimConfigSchema>

const AnchorSchema = z.strictObject({
  pose: IdSchema,
  /** Where the body rests (the pose's contact point), in metres in the item's frame at turn 0. */
  at: point,
  /** Which way the Sim faces, about the vertical: 0 is the item's front (+z), 90 its right. */
  headingDeg: degrees,
  /** Floor points the Sim walks to before taking the pose, best first. */
  approach: z.array(point).min(1),
  /** Where a step's `anchor` prop stands (a pan on the hob). */
  prop: point.optional(),
})

const SpotSchema = z.strictObject({
  pose: IdSchema,
  /** A floor cell: the spot is its centre. */
  slot: z.string().regex(SLOT_ID, 'spots are floor cells f<c>-<r>'),
  rotationDeg: degrees,
  heightM: nonNegative,
})

/** Fallback spots for poses the room's furniture cannot give (lying on the rug, no bed). */
const HomeSimSchema = z.strictObject({ spots: z.array(SpotSchema) })

export const InteractionsFileSchema = z.strictObject({
  /** Models a Sim walks over (rugs). */
  walkable: z.array(IdSchema),
  /** Interaction points by furniture model id (scene.json `models.decor`, the fixtures' models). */
  models: z.record(IdSchema, z.array(AnchorSchema).min(1)),
  homes: z.strictObject(
    Object.fromEntries(HOME_IDS.map((id) => [id, HomeSimSchema])) as unknown as Record<
      (typeof HOME_IDS)[number],
      typeof HomeSimSchema
    >,
  ),
})
export type InteractionsFile = z.infer<typeof InteractionsFileSchema>
