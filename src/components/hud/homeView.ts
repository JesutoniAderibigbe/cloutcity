/**
 * What the 3D room shows for the player's home as it stands (S16, S40): every placed item with
 * its cell, turn, mount, footprint and colour, and the wall paint and floor finish on now. The Home
 * panel shows this; buy mode (HomeDecor.tsx) starts from it and adds its preview (a held item, the
 * grid, a finish being tried on).
 */
import { engineConfig } from '@/engine/config'
import { currentFinish, decorTurn } from '@/engine/home'
import { findItem, isDecor, type DecorDef } from '@/engine/items'
import type { PlayerState } from '@/engine/game'
import type { ApartmentPlacement } from '@/scene/apartment/types'

export function decorDef(itemId: string): DecorDef | null {
  const item = findItem(itemId, engineConfig)
  return item !== undefined && isDecor(item) ? item : null
}

/** One owned item as the room draws it at `slotId`, or null when it is not drawable decor. */
export function placementOf(
  player: Pick<PlayerState, 'inventory'>,
  itemId: string,
  slotId: string,
  turn = decorTurn(player.inventory.decor.find((owned) => owned.itemId === itemId)),
): ApartmentPlacement | null {
  const def = decorDef(itemId)
  const owned = player.inventory.decor.find((entry) => entry.itemId === itemId)
  if (def === null || owned === undefined) return null
  const token =
    def.decor.variants.find((variant) => variant.id === owned.variant)?.token ??
    def.decor.variants[0]?.token
  if (token === undefined) return null
  return { itemId, slotId, turn, token, mount: def.decor.fits, footprint: def.decor.footprint }
}

/** Every placed item, by item id. */
export function placedView(
  player: Pick<PlayerState, 'inventory' | 'apartment'>,
): Record<string, ApartmentPlacement> {
  const result: Record<string, ApartmentPlacement> = {}
  for (const [slotId, itemId] of Object.entries(player.apartment.placed)) {
    const placement = placementOf(player, itemId, slotId)
    if (placement !== null) result[itemId] = placement
  }
  return result
}

/** The wall paint and floor finish on now (the home's originals unless others were applied). */
export function finishesView(player: Pick<PlayerState, 'home' | 'apartment'>) {
  return {
    wall: currentFinish(player, 'wall', engineConfig),
    floor: currentFinish(player, 'floor', engineConfig),
  }
}
