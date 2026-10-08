/**
 * The look as models and colours (S16a, D9): pure, shared by the map, the apartment, the creator
 * preview, the showcase and later other players (S31). It takes what the engine says is drawn
 * (src/engine/avatarLook.ts `effectiveLook`: option ids and catalog model ids) and turns it into
 * ModelRefs from the derived avatar refs (types.ts) with every slot colour as hex.
 *
 * - S16b: the body frame picks the rig, the bald face and the outfit's body variant.
 * - Attachments not in the refs (the Blender pieces pending their refit to the realistic frame,
 *   options.json `pending`) are left out and listed in `missing`, so every look draws.
 * - A colour applies only to a slot the model has, and only when the palette has the token.
 * - Attachments follow a rig joint: one with a scene.json `avatarLook` entry sits at its offset;
 *   the rest (pack hair and Blender pieces, built in the character's bind pose) at their catalog
 *   `attach` joint (the head unless it says the torso), with no offset.
 */
import type { EffectiveLook } from '@/engine/avatarLook'
import type { AvatarOptions } from '@/lib/data/schemas/avatar'
import type { AvatarColors, AvatarParts } from '../models/AvatarModel'
import type { SlotColors } from '../models/slots'
import type { ModelRef } from '../models/types'
import type { AvatarSceneRefs } from './types'

/** One static model fixed to a rig joint. */
export interface AvatarAttachment {
  readonly ref: ModelRef
  readonly colors?: SlotColors
  readonly joint: string
  /** Metres in the character's bind pose. */
  readonly offset: readonly [number, number, number]
}

export interface ResolvedLook {
  readonly parts: AvatarParts
  readonly colors: AvatarColors
  /** Root scale (the height option). */
  readonly scale: number
  /** The head's top in metres at scale 1 (the capsule fits its height to it). */
  readonly heightM: number
  /** The low tier's capsule colours: the skin tone and the top (null without a palette hex). */
  readonly tint: { readonly skin: string | null; readonly top: string | null }
  /** Model ids the look names that are not built yet (part A0), skipped. */
  readonly missing: readonly string[]
}

/** Which look colour each recolourable slot takes, whatever model it is on. */
const SLOT_SOURCE: Readonly<Record<string, 'skin' | 'hair' | 'top' | 'bottom' | 'shoes'>> = {
  skin: 'skin',
  shell: 'skin',
  hair: 'hair',
  top: 'top',
  fabric: 'top',
  bottom: 'bottom',
  shoes: 'shoes',
}

const ORIGIN = [0, 0, 0] as const

function tokenOf(list: readonly { readonly id: string; readonly token: string }[], id: string) {
  const found = list.find((option) => option.id === id)
  if (found === undefined) throw new Error(`resolveLook: unknown option "${id}"`)
  return found.token
}

export function resolveLook(
  drawn: EffectiveLook,
  options: AvatarOptions,
  refs: AvatarSceneRefs,
): ResolvedLook {
  const { look } = drawn
  const missing: string[] = []
  const hex = (token: string) => refs.colors[token]
  const source = {
    skin: hex(tokenOf(options.skinTones, look.skin)),
    hair: hex(tokenOf(options.hairColors, look.hairColor)),
    top: hex(tokenOf(options.garmentColors, look.top)),
    bottom: hex(tokenOf(options.garmentColors, look.bottom)),
    shoes: hex(tokenOf(options.garmentColors, look.shoes)),
  }
  const colorsFor = (ref: ModelRef): SlotColors | undefined => {
    const colors: Record<string, string> = {}
    for (const slot of ref.slots) {
      const from = SLOT_SOURCE[slot]
      const value = from === undefined ? undefined : source[from]
      if (value !== undefined) colors[slot] = value
    }
    return Object.keys(colors).length === 0 ? undefined : colors
  }
  const model = (id: string): ModelRef | undefined => {
    const ref = refs.models[id]
    if (ref === undefined) missing.push(id)
    return ref
  }

  const rig = model(drawn.rig)
  const head = model(drawn.head)
  const body = model(drawn.body)
  if (rig === undefined || head === undefined || body === undefined) {
    throw new Error(
      `resolveLook: no rig, head or body for ${drawn.rig} / ${drawn.head} / ${drawn.body}`,
    )
  }
  const attachments: AvatarAttachment[] = []
  for (const id of drawn.attachments) {
    const ref = model(id)
    if (ref === undefined) continue
    const place = refs.attachments[id]
    const colors = colorsFor(ref)
    attachments.push({
      ref,
      ...(colors === undefined ? {} : { colors }),
      joint: place?.joint ?? ref.attach ?? 'head',
      offset: place?.offset ?? ORIGIN,
    })
  }

  const headColors = colorsFor(head)
  const bodyColors = colorsFor(body)
  return {
    parts: { rig, head, body, attachments },
    colors: {
      ...(headColors === undefined ? {} : { head: headColors }),
      ...(bodyColors === undefined ? {} : { body: bodyColors }),
    },
    scale: drawn.scale,
    heightM: head.bounds?.max[1] ?? 1,
    tint: { skin: source.skin ?? null, top: source.top ?? null },
    missing,
  }
}
