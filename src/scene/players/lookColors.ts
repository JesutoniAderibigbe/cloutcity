/**
 * A real player's look as the townsfolk kits can draw it (S42 phase 1): the body (which kit) and
 * the four recoloured buckets (skin, top, bottom, and hair as the accent), resolved from the look
 * ids the server sends through data/avatar/options.json and its swatches. Also the human colour
 * names the player card shows (A11Y-1/2: every swatch has a name). Loaded only in the presence
 * chunks, never on the path to playable.
 *
 * Unknown ids fall back to the creator's defaults, so a look from a newer build still draws.
 */
import optionsJson from '@data/avatar/options.json'
import swatchesJson from '@data/avatar/swatches.derived.json'
import type { CopyKey } from '@/lib/copy'
import type { LookIds } from '@/realtime/types'

interface ColourOption {
  readonly id: string
  readonly token: string
  readonly nameKey: string
}

const options = optionsJson as unknown as {
  readonly skinTones: readonly ColourOption[]
  readonly hairColors: readonly ColourOption[]
  readonly garmentColors: readonly ColourOption[]
  readonly defaults: Readonly<Record<string, string>>
}
const swatches = (swatchesJson as { colors: Readonly<Record<string, string>> }).colors

/** Kit order (src/lib/world/ambient/townsfolk.ts TOWNSFOLK_BODIES). */
export const LOOK_BODIES = ['woman', 'man'] as const
export type LookBody = (typeof LOOK_BODIES)[number]

export interface Swatch {
  readonly hex: string
  readonly nameKey: CopyKey
}

export interface LookColours {
  readonly body: LookBody
  readonly skin: Swatch
  readonly top: Swatch
  readonly bottom: Swatch
  readonly hair: Swatch
}

function swatch(list: readonly ColourOption[], id: string | undefined, fallback: string): Swatch {
  const option = list.find((o) => o.id === id) ?? list.find((o) => o.id === fallback) ?? list[0]
  const hex = option === undefined ? undefined : swatches[option.token]
  // A data error (an option with no swatch), which lookColors.test.ts rules out for every id.
  if (option === undefined || hex === undefined) throw new Error('lookColours: no swatch')
  return { hex, nameKey: option.nameKey as CopyKey }
}

/** The look's body and colours; defaults for any missing or unknown id. */
export function lookColours(look: LookIds | null): LookColours {
  const d = options.defaults
  const get = (field: string) => look?.[field] ?? d[field]
  const body = get('body')
  return {
    body: body === 'man' ? 'man' : 'woman',
    skin: swatch(options.skinTones, get('skin'), d.skin ?? ''),
    top: swatch(options.garmentColors, get('top'), d.top ?? ''),
    bottom: swatch(options.garmentColors, get('bottom'), d.bottom ?? ''),
    hair: swatch(options.hairColors, get('hairColor'), d.hairColor ?? ''),
  }
}
