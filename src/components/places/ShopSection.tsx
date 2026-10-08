'use client'

import { useEffect, useRef, useState } from 'react'
// Read directly (validated in src/lib/data/data.test.ts): the classic-zod loader must stay out
// of client chunks. Both are small; this module loads with the place sheet, never at boot.
import looksJson from '@data/items/looks.json'
import thumbsJson from '@data/items/thumbs.derived.json'
import { engineConfig } from '@/engine/config'
import { giftCount, isDecor, isWearable, shopItems, type ShopItemDef } from '@/engine/items'
import { shopBlock } from '@/engine/placeActions'
import type { Place } from '@/engine/places'
import { ignoreKeyRepeat } from '@/components/overlay/useActionGuard'
import { copy } from '@/lib/copy'
import { log } from '@/lib/log'
import {
  alreadyOwnedLabel,
  boughtNotice,
  buyLabel,
  cannotAffordLabel,
  itemErrorText,
  itemName,
  shopItemDetails,
  stackFullLabel,
} from '@/lib/shopCopy'
import { placeBlockReason } from '@/lib/world/placeActionCopy'
import { gameStore, useGameStore, type GameState } from '@/state/store'

const thumbs: Readonly<Record<string, string>> = thumbsJson
const looks: { readonly icons: Readonly<Record<string, string>> } = looksJson

/** Rarity tints for the thumbnail tile (theme tokens through Tailwind utilities). */
const RARITY_TILE: Readonly<Record<ShopItemDef['rarity'], string>> = {
  common: 'bg-canvas/80',
  medium: 'bg-success/15',
  rare: 'bg-taxi/30',
}

/**
 * An item's thumbnail (S04k): the offline render of its CC0 model (npm run thumbs, served from
 * public/thumbs, content-named so the browser keeps it), else its icon (data/items/looks.json),
 * on a tile tinted by rarity. Decorative: the row's text and the Buy button name the item. The
 * image is lazy and sized up front, so a long list neither fetches nor shifts before scrolling.
 */
function ItemThumb({ item }: { readonly item: ShopItemDef }) {
  const src = thumbs[item.id]
  return (
    <span
      aria-hidden="true"
      data-shop-thumb={src === undefined ? 'icon' : 'render'}
      className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-2xl leading-none ${RARITY_TILE[item.rarity]}`}
    >
      {src === undefined ? (
        (looks.icons[item.id] ?? null)
      ) : (
        // A 2 KB prerendered WebP: next/image would add its loader to this chunk for nothing.
        // eslint-disable-next-line @next/next/no-img-element -- see above
        <img src={src} alt="" width={48} height={48} loading="lazy" decoding="async" />
      )}
    </span>
  )
}

const BUTTON =
  'min-h-11 min-w-11 shrink-0 rounded-xl bg-raised px-3 py-2 text-center text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus enabled:hover:bg-pressed disabled:opacity-70'

/**
 * Why the player cannot buy `item` here right now, as player-facing text, or null when they
 * can. Mirrors the engine's checks in `buyAtShop` (shop open, owned once, gift stack, funds),
 * which re-runs them on every buy.
 */
function buyBlockReason(
  item: ShopItemDef,
  place: Place,
  state: Pick<GameState, 'clock' | 'player'>,
): string | null {
  const block = shopBlock(place, state, engineConfig)
  if (block !== null) return placeBlockReason(block, place)
  const { inventory, cash } = state.player
  if (isWearable(item) || isDecor(item)) {
    const owned = isWearable(item) ? inventory.wearables : inventory.decor
    if (owned.some((entry) => entry.itemId === item.id)) return alreadyOwnedLabel(item.id)
  } else {
    const max = engineConfig.items.maxGiftStack
    if (giftCount(inventory, item.id) >= max) return stackFullLabel(item.id, max)
  }
  if (cash < item.price) return cannotAffordLabel(item.id, cash)
  return null
}

/**
 * The shop at a boutique or thrift store (S10a), inside the place sheet: every item for sale
 * with its name, slot, rarity and price, and a Buy button. A disabled Buy button says why in
 * its accessible name (closed, owned, hands full, or the cash shortfall). Buying goes through
 * the store to the engine; the result or refusal shows in the status line.
 */
export function ShopSection({
  place,
  headingId,
}: {
  readonly place: Place
  readonly headingId: string
}) {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  // The nonce re-runs the focus check for every buy, even when two buys read the same. The item
  // is where the result shows: next to the Buy button that was pressed (S04k), not at the end
  // of a long list.
  const [result, setResult] = useState<{
    readonly text: string
    readonly nonce: number
    readonly itemId: string
    readonly ok: boolean
  } | null>(null)
  const ref = useRef<HTMLElement>(null)
  const activated = useRef<HTMLButtonElement | null>(null)

  // A buy can disable the Buy button under the tap (a wearable bought, a gift stack filled).
  // A disabled button keeps document focus in some browsers but takes no keys, and in others
  // focus drops to the body; either way, move it to the shop heading.
  useEffect(() => {
    const section = ref.current
    const button = activated.current
    activated.current = null
    if (result === null || section === null) return
    const lost = button !== null && (button.disabled || !button.isConnected)
    if (lost || !section.contains(document.activeElement)) {
      section.querySelector<HTMLElement>('h3')?.focus()
    }
  }, [result])

  const show = (itemId: string, ok: boolean, text: string) =>
    setResult((last) => ({ text, itemId, ok, nonce: (last?.nonce ?? 0) + 1 }))

  const buy = (itemId: string, button: HTMLButtonElement) => {
    activated.current = button
    const outcome = gameStore.getState().buyAtShop(place, itemId)
    if (outcome.ok) {
      show(itemId, true, boughtNotice(itemId, outcome.price))
      return
    }
    // The UI only enables what the engine allows, so a refusal means the state moved under it.
    log.info('A shop purchase was refused', { placeId: place.id, itemId, code: outcome.error.code })
    const { error } = outcome
    show(
      itemId,
      false,
      error.code === 'BLOCKED'
        ? placeBlockReason(error.block, place)
        : error.code === 'NOT_A_SHOP'
          ? copy('shop.error.failed')
          : itemErrorText(error),
    )
  }

  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      data-shop={place.id}
      className="flex flex-col gap-1.5"
    >
      <h3
        id={headingId}
        tabIndex={-1}
        className="text-xs font-bold text-muted uppercase focus:outline-none"
      >
        {copy('shop.heading')}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {shopItems(engineConfig).map((item) => {
          const reason = buyBlockReason(item, place, { clock, player })
          const feedback = result?.itemId === item.id ? result : null
          return (
            <li
              key={item.id}
              data-shop-item={item.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-canvas/60 p-2"
            >
              <ItemThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-fg">{itemName(item.id)}</p>
                <p className="text-xs text-muted">{shopItemDetails(item.id)}</p>
                {feedback === null ? (
                  reason === null ? null : (
                    <p className="text-xs text-taxi-ink">{reason}</p>
                  )
                ) : (
                  // Seen where the tap was; the section's live region announces it (once).
                  <p
                    key={feedback.nonce}
                    aria-hidden="true"
                    data-shop-feedback={feedback.ok ? 'bought' : 'refused'}
                    className="shop-feedback text-xs font-bold text-taxi-ink"
                  >
                    {feedback.ok ? '✓ ' : ''}
                    {feedback.text}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={reason !== null}
                aria-label={
                  reason === null
                    ? buyLabel(item.id)
                    : copy('place.action.blockedLabel', { action: buyLabel(item.id), reason })
                }
                onKeyDown={ignoreKeyRepeat}
                onClick={(event) => buy(item.id, event.currentTarget)}
                className={BUTTON}
              >
                {copy('shop.buy.button')}
              </button>
            </li>
          )
        })}
      </ul>
      {/* aria-live rather than role="status": the sheet already has a status line. Read by
          screen readers only: sighted players see the result in the item's own row (S04k). */}
      <p aria-live="polite" data-shop-status="" className="sr-only">
        {result?.text}
      </p>
    </section>
  )
}
