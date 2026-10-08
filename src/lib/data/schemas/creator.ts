/**
 * Schema for data/config/creator.json (S16a): the "Make it you" creator's offer, its steps in
 * order (a registry the UI maps to lazy step components; `origin` is the S44 seam, disabled) and
 * the scope of each roll (src/engine/creator.ts `commitRoll`).
 */
import { z } from 'zod'
import { CREATOR_STEP_IDS, ROLL_KINDS, ROLL_SCOPES } from '../avatarIds'

export { CREATOR_STEP_IDS, ROLL_KINDS, ROLL_SCOPES }

const enabled = z.boolean().optional()

const StepSchema = z.discriminatedUnion('id', [
  z.strictObject({ id: z.literal('look'), enabled }),
  z.strictObject({ id: z.literal('traits'), enabled, pick: z.int().min(1).max(4) }),
  z.strictObject({ id: z.literal('dream'), enabled }),
  z.strictObject({ id: z.literal('origin'), enabled, roll: z.enum(ROLL_KINDS).optional() }),
  z.strictObject({ id: z.literal('neighborhood'), enabled, roll: z.literal('neighborhood') }),
  z.strictObject({ id: z.literal('home'), enabled }),
])

export const CreatorConfigSchema = z
  .strictObject({
    version: z.literal(1),
    /** State-changing actions before the creator is offered (never before the first one). */
    offerAfterActions: z.int().min(1),
    /** The offer waits until the S06 tour is over. */
    waitForTour: z.boolean(),
    steps: z.array(StepSchema).length(CREATOR_STEP_IDS.length),
    rolls: z.partialRecord(z.enum(ROLL_KINDS), z.strictObject({ scope: z.enum(ROLL_SCOPES) })),
    /** Game days before a chosen career path or trait pair can change again. */
    changeCooldownGameDays: z.int().min(1),
  })
  .refine((config) => config.steps.every((step, i) => step.id === CREATOR_STEP_IDS[i]), {
    error: 'steps must list every step once, in the creator order',
    path: ['steps'],
  })
  .refine(
    (config) =>
      config.steps.every(
        (step) =>
          !('roll' in step) || step.roll === undefined || config.rolls[step.roll] !== undefined,
      ),
    { error: 'a step rolls something with no scope in rolls', path: ['rolls'] },
  )
  .refine((config) => config.steps.some((step) => step.id === 'look' && step.enabled !== false), {
    error: 'the look step is always on',
    path: ['steps'],
  })
export type CreatorConfig = z.infer<typeof CreatorConfigSchema>
