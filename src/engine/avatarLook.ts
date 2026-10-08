/**
 * What the avatar draws (S16a, D8/D12): the creator's look with worn items over it (a worn item
 * always wins), the head swapped to the bald base under a covering that hides hair, and the
 * attachments in priority order, capped. It takes the public avatar (the look ids and the worn
 * item ids, src/engine/appearance.ts `publicAvatar`), so other players (S31) draw the same way. It reads the full look options (models), so it runs in
 * the avatar and creator chunks, never on the playable path (PERF-6).
 */
import type { ItemLook } from '@/lib/data/schemas/content'
import type { Look, PublicAvatar } from './appearance'
import type { EngineConfig } from './config'
import type { CreatorEngineConfig } from './creatorConfig'
import { findItem, ITEM_SLOTS } from './items'

/** What the avatar shows: models and the attachments, by catalog model id (A2 resolves colours). */
export interface EffectiveLook {
  /** The creator's look with worn items over it (outfit, top, bottom and shoes). */
  readonly look: Look
  /** Head model: the hairstyle's head, or the bald base when the style or a covering needs it. */
  readonly head: string
  /** Body model: the outfit's body. */
  readonly body: string
  /** Attachment model ids, in priority order, at most `attachments.max`. */
  readonly attachments: readonly string[]
  /** True when a head covering hides the hair (the hairstyle is kept for when it comes off). */
  readonly hairHidden: boolean
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
 * marked `hidesHair` puts the bald base head on and hides the hair piece; attachments are kept
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
    if (worn.part === 'outfit') look = { ...look, outfit: worn.outfit, top: worn.top }
    else if (worn.part === 'bottom') look = { ...look, bottom: worn.color }
    else if (worn.part === 'shoes') look = { ...look, shoes: worn.color }
    else if (worn.part === 'attachment') items.push(worn.model)
  }
  const style = optionOf(options.hairStyles, look.hairStyle)
  const headwear = optionOf(options.headwear, look.headwear)
  const hairHidden = headwear.hidesHair === true
  const byKind: Record<string, readonly string[]> = {
    headwear: headwear.model === undefined ? [] : [headwear.model],
    hairPiece: hairHidden || style.piece === undefined ? [] : [style.piece],
    facialHair: modelOf(options.facialHair, look.facialHair),
    eyewear: modelOf(options.eyewear, look.eyewear),
    ears: modelOf(options.ears, look.ears),
    item: items,
  }
  const attachments = options.attachments.priority
    .flatMap((kind) => byKind[kind] ?? [])
    .slice(0, options.attachments.max)
  return {
    look,
    head: hairHidden ? baseHead(options) : style.head,
    body: optionOf(options.outfits, look.outfit).body,
    attachments,
    hairHidden,
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

/** The bald head the hair pieces sit on: the head of the first hairstyle that has a piece. */
function baseHead(options: CreatorEngineConfig['options']): string {
  const withPiece = options.hairStyles.find((style) => style.piece !== undefined)
  if (withPiece === undefined) throw new Error('avatarLook: no hairstyle uses a base head')
  return withPiece.head
}
