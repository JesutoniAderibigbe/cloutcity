/**
 * What the avatar draws (S16a, D8/D12; S16b frames): the creator's look with worn items over it
 * (a worn item always wins), the body frame's bald face, rig and outfit variant, the hair piece
 * hidden under a covering that hides hair, and the attachments in priority order, capped. It takes the public avatar (the look ids and the worn
 * item ids, src/engine/appearance.ts `publicAvatar`), so other players (S31) draw the same way. It reads the full look options (models), so it runs in
 * the avatar and creator chunks, never on the playable path (PERF-6).
 */
import type { ItemLook } from '@/lib/data/schemas/content'
import type { Look, PublicAvatar } from './appearance'
import type { EngineConfig } from './config'
import type { CreatorEngineConfig } from './creatorConfig'
import { findItem, ITEM_SLOTS } from './items'

/** A body frame's hair cap (data/avatar/options.json `bodies[].hairCap`). */
export interface HairCap {
  readonly model: string
  readonly scale?: readonly [number, number, number]
  readonly offset?: readonly [number, number, number]
}

/** What the avatar shows: models and the attachments, by catalog model id (A2 resolves colours). */
export interface EffectiveLook {
  /** The creator's look with worn items over it (outfit, top, bottom and shoes). */
  readonly look: Look
  /** Head model: the body frame's bald face (S16b). */
  readonly head: string
  /** Body model: the outfit's variant for the body frame. */
  readonly body: string
  /** Rig model: the body frame's rig, whose clips pose it (S16b). */
  readonly rig: string
  /** Attachment model ids, in priority order, at most `attachments.max`. */
  readonly attachments: readonly string[]
  /** True when a head covering hides the hair (the hairstyle is kept for when it comes off). */
  readonly hairHidden: boolean
  /**
   * The hair cap under the hair piece (S04p): its model (also in `attachments`), drawn in the
   * hair colour and fitted to the frame's skull; null when no hair piece is drawn.
   */
  readonly hairCap: HairCap | null
  /** Root scale of the rig (the height option). */
  readonly scale: number
}

function optionOf<T extends { readonly id: string }>(list: readonly T[], id: string): T {
  const option = list.find((entry) => entry.id === id)
  if (option === undefined) throw new Error(`avatarLook: unknown option "${id}"`)
  return option
}

/** The `look` of every worn wearable, in outfit slot order. */
function wornLooks(worn: readonly string[], config: EngineConfig): ItemLook[] {
  const items = worn.flatMap((itemId) => {
    const item = findItem(itemId, config)
    return item !== undefined && 'look' in item && item.look !== undefined ? [item] : []
  })
  return ITEM_SLOTS.flatMap((slot) =>
    items.filter((item) => item.slot === slot).map((item) => item.look),
  )
}

/**
 * The look as drawn: worn items override the creator's base choice (a top sets the outfit and
 * its top colour, bottoms and shoes their colour, an accessory adds an attachment); a covering
 * marked `hidesHair` hides the hair piece; attachments are kept
 * in `attachments.priority` order up to `attachments.max`.
 */
export function effectiveLook(
  avatar: PublicAvatar,
  config: EngineConfig,
  creator: CreatorEngineConfig,
): EffectiveLook {
  const options = creator.options
  let look: Look = avatar.look
  const items: string[] = []
  for (const worn of wornLooks(avatar.worn, config)) {
    if (worn.part === 'outfit') {
      // A worn outfit the body frame has no variant of keeps the creator's outfit (S16b).
      const fits = options.outfits.some(
        (outfit) => outfit.id === worn.outfit && outfit.variants[look.body] !== undefined,
      )
      look = fits ? { ...look, outfit: worn.outfit, top: worn.top } : { ...look, top: worn.top }
    } else if (worn.part === 'bottom') look = { ...look, bottom: worn.color }
    else if (worn.part === 'shoes') look = { ...look, shoes: worn.color }
    else if (worn.part === 'attachment') items.push(worn.model)
  }
  const frame = optionOf(options.bodies, look.body)
  const style = optionOf(options.hairStyles, look.hairStyle)
  const headwear = optionOf(options.headwear, look.headwear)
  const hairHidden = headwear.hidesHair === true
  const hairPiece = hairHidden || style.piece === undefined ? [] : [style.piece]
  // S04p: under a hair piece the frame wears its hair cap in the hair colour, so the gaps the
  // pack styles leave at the crown and the nape read as hair, not scalp, on either face.
  // Otherwise (bald, or the hair under a covering) a frame whose bald head is open behind the
  // hairline wears its skin-toned scalp cap (S16b), which sits inside every covering.
  const hairCap = hairPiece.length > 0 ? (frame.hairCap ?? null) : null
  const cap = hairCap?.model ?? frame.scalpCap
  const byKind: Record<string, readonly string[]> = {
    headwear: headwear.model === undefined ? [] : [headwear.model],
    hairPiece,
    scalpCap: cap === undefined ? [] : [cap],
    facialHair: modelOf(options.facialHair, look.facialHair),
    eyewear: modelOf(options.eyewear, look.eyewear),
    ears: modelOf(options.ears, look.ears),
    item: items,
  }
  const outfit = optionOf(options.outfits, look.outfit)
  // An outfit can hide an attachment that clashes with it (the outdoors pack and the tote).
  const hidden = new Set(outfit.hides ?? [])
  // The scalp or hair cap is part of the head, so it never takes an attachment's place.
  const attachments = [
    ...(byKind.scalpCap ?? []),
    ...options.attachments.priority
      .flatMap((kind) => byKind[kind] ?? [])
      .filter((model) => !hidden.has(model))
      .slice(0, options.attachments.max),
  ]
  const body = outfit.variants[frame.id]
  if (body === undefined) {
    throw new Error(`avatarLook: outfit "${outfit.id}" has no ${frame.id} variant`)
  }
  return {
    look,
    head: frame.head,
    body,
    rig: frame.rig,
    attachments,
    hairHidden,
    hairCap,
    scale: optionOf(options.heights, look.height).scale,
  }
}

function modelOf(
  list: readonly { readonly id: string; readonly model?: string }[],
  id: string,
): readonly string[] {
  const model = optionOf(list, id).model
  return model === undefined ? [] : [model]
}
