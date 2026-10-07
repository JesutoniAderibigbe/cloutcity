/**
 * The handle form (S18a): one zod/mini schema for the shared form pattern (GR-1, GR-2, GR-8),
 * whose messages are copy keys, and the shapes of the handle RPCs' answers.
 *
 * The schema says *why* a handle is refused; HANDLE_PATTERN, the database's own format check
 * (`private.handle_format_ok`), is the last word, so the form can never accept what the server
 * refuses. The value checked is the normalised preview (normaliseHandleInput), which the form
 * shows the player before anything is sent (GR-6).
 */
import handlesJson from '@data/config/handles.json'
import * as z from 'zod/mini'
import type { CopyKey } from '@/lib/copy'
import type { HandlesConfig } from '@/lib/data/schemas/config'
import { handlePattern, type HandleRules } from '@/lib/handles/normalise'
// The error keys below are rendered by fieldErrors, which needs their namespace loaded.
import '@/lib/copy/ns/profile'

/** data/config/handles.json, validated by HandlesConfigSchema in src/lib/data/data.test.ts. */
export const handlesConfig: HandlesConfig = handlesJson

/** The format rule the database enforces (src/lib/handles/parity.test.ts checks they match). */
export const HANDLE_PATTERN = handlePattern(handlesConfig)

export const HANDLE_FIELDS = ['handle'] as const
export type HandleField = (typeof HANDLE_FIELDS)[number]

export interface HandleValues {
  readonly handle: string
}

const ERROR = {
  tooShort: 'profile.handle.error.tooShort',
  tooLong: 'profile.handle.error.tooLong',
  characters: 'profile.handle.error.characters',
  start: 'profile.handle.error.start',
  underscores: 'profile.handle.error.underscores',
  letters: 'profile.handle.error.letters',
} as const satisfies Record<string, CopyKey>

const letterCount = (value: string) => value.replace(/[^A-Za-z]/g, '').length

/**
 * The handle form's schema. Issues come in this order, so the first one shown is the most
 * useful: length, characters, first character, underscores, letters, then the pattern itself.
 */
export function createHandleSchema(rules: HandleRules = handlesConfig) {
  const pattern = handlePattern(rules)
  return z.object({
    handle: z.string().check(
      z.minLength(rules.minLength, ERROR.tooShort),
      z.maxLength(rules.maxLength, ERROR.tooLong),
      z.regex(/^[A-Za-z0-9_]*$/, ERROR.characters),
      z.regex(/^(?:[A-Za-z]|$)/, ERROR.start),
      z.refine((value) => !value.includes('__') && !value.endsWith('_'), ERROR.underscores),
      z.refine((value) => letterCount(value) >= rules.minLetters, ERROR.letters),
      z.regex(pattern, ERROR.characters),
    ),
  })
}

/** What `check_handle` answers for the form's live availability check. */
export const HANDLE_CHECK_STATUSES = [
  'available',
  'current',
  'taken',
  'invalid',
  'not_allowed',
] as const
export type HandleCheckStatus = (typeof HANDLE_CHECK_STATUSES)[number]

const HandleCheckStatusSchema = z.enum(HANDLE_CHECK_STATUSES)

/** Reads `check_handle`'s answer; anything unexpected is null (show no availability). */
export function parseHandleCheckStatus(value: unknown): HandleCheckStatus | null {
  const result = HandleCheckStatusSchema.safeParse(value)
  return result.success ? result.data : null
}

/** One row of `get_my_profile` / `set_handle`. */
export const MyProfileSchema = z.object({
  handle: z.nullable(z.string()),
  public_level: z.string(),
  career_path: z.nullable(z.string()),
  avatar: z.record(z.string(), z.unknown()),
  handle_generated: z.boolean(),
  free_handle_change: z.boolean(),
  handle_changes_left: z.int().check(z.gte(0)),
  next_handle_change_at: z.nullable(z.string()),
})
export type MyProfile = z.infer<typeof MyProfileSchema>
