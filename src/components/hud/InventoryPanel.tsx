'use client'

import { useEffect, useState } from 'react'
import { engineConfig } from '@/engine/config'
import { findItem, isWearable, resaleValue, type ItemResult } from '@/engine/items'
import { copy } from '@/lib/copy'
import { log } from '@/lib/log'
import {
  equipLabel,
  equippedNotice,
  giftCountLine,
  giftUsedOnSelfNotice,
  inventoryItemDetails,
  itemErrorText,
  itemName,
  resaleLine,
  sellLabel,
  soldNotice,
  unequipLabel,
  unequippedNotice,
  // Aliased: a `use` prefix reads as a React hook to the hooks lint rule.
  useGiftOnSelfLabel as giftOnSelfLabel,
} from '@/lib/shopCopy'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { closeHudPanel } from '@/state/hudPanel'
import { gameStore, useGameStore } from '@/state/store'
import { PANEL_BUTTON, PanelDialog, PanelStatus } from './PanelDialog'

const ACTION = `${PANEL_BUTTON} bg-night-800 text-center text-sm text-ink-50 enabled:hover:bg-night-700`

/**
 * The inventory panel (S10a), opened from the HUD: owned wearables with Wear / Take off and
 * Sell (at the engine's current resale value), and gifts with Use on yourself and Sell. Every
 * action goes through the store to the engine; the result, or the engine's refusal, shows in
 * voice in the status line. Loaded lazily by HudPanelMount (DEC-11).
 */
export function InventoryPanel() {
  const inventory = useGameStore((state) => state.player.inventory)
  const minute = useGameStore((state) => state.clock.minute)
  // The nonce re-runs the focus check for every action, even when two results read the same.
  const [result, setResult] = useState<{ readonly text: string; readonly nonce: number } | null>(
    null,
  )
  // Held keys, double clicks, a drifting double tap: a second activation must never land on the
  // button that replaced the one tapped (Wear becomes Take off in place; a removed row lets the
  // next row's button slide under the finger).
  const { guard: act, onKeyDown, coolingDown } = useActionGuard()

  // An action that removes the focused row (selling the last copy) would drop focus on the
  // body; keep it in the panel instead.
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[data-hud-panel-dialog="inventory"]')
    if (result === null || dialog === null || dialog.contains(document.activeElement)) return
    dialog.querySelector<HTMLElement>('h2')?.focus()
  }, [result, inventory])

  const show = (text: string) => setResult((last) => ({ text, nonce: (last?.nonce ?? 0) + 1 }))

  const report = (outcome: ItemResult, itemId: string, done: () => string) => {
    if (outcome.ok) {
      show(done())
      return
    }
    // The UI only offers what the engine allows, so a refusal means the state moved under it.
    log.info('An inventory action was refused', { itemId, code: outcome.error.code })
    show(itemErrorText(outcome.error))
  }

  const sell = (itemId: string) => {
    const outcome = gameStore.getState().sellItem(itemId)
    report(outcome, itemId, () => soldNotice(itemId, outcome.ok ? outcome.amount : 0))
  }

  const wearables = inventory.wearables.flatMap((owned) => {
    const def = findItem(owned.itemId, engineConfig)
    return def !== undefined && isWearable(def) ? [{ owned, def }] : []
  })
  const gifts = inventory.gifts.flatMap((stack) => {
    const def = findItem(stack.itemId, engineConfig)
    return def === undefined ? [] : [{ stack, def }]
  })
  const empty = wearables.length === 0 && gifts.length === 0

  return (
    <PanelDialog title={copy('inventory.heading')} panel="inventory" onClose={closeHudPanel}>
      {empty ? <p className="text-sm text-ink-300">{copy('inventory.empty')}</p> : null}
      {wearables.length === 0 ? null : (
        <section aria-label={copy('inventory.wearables.heading')} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-bold text-ink-300 uppercase">
            {copy('inventory.wearables.heading')}
          </h3>
          <ul aria-busy={coolingDown} className="flex flex-col gap-1.5">
            {wearables.map(({ owned, def }) => {
              const worn = inventory.outfit[def.slot] === def.id
              const resale = resaleValue(def, owned.acquiredMinute, minute, engineConfig)
              return (
                <li
                  key={def.id}
                  data-inventory-item={def.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-night-950/60 p-2"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-50">
                      {itemName(def.id)}{' '}
                      {worn ? (
                        <span className="ml-1 text-xs font-bold text-taxi-400">
                          {copy('inventory.wearing')}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-300">{inventoryItemDetails(def.id)}</p>
                    <p className="text-xs text-ink-300">{resaleLine(resale)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {worn ? (
                      <button
                        type="button"
                        onKeyDown={onKeyDown}
                        aria-label={unequipLabel(def.id, def.slot)}
                        onClick={(event) =>
                          act(event, def.id, () =>
                            report(gameStore.getState().unequipSlot(def.slot), def.id, () =>
                              unequippedNotice(def.id),
                            ),
                          )
                        }
                        className={ACTION}
                      >
                        {copy('inventory.unequip.button')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onKeyDown={onKeyDown}
                        aria-label={equipLabel(def.id, def.slot)}
                        onClick={(event) =>
                          act(event, def.id, () =>
                            report(gameStore.getState().equipItem(def.id, def.slot), def.id, () =>
                              equippedNotice(def.id),
                            ),
                          )
                        }
                        className={ACTION}
                      >
                        {copy('inventory.equip.button')}
                      </button>
                    )}
                    <button
                      type="button"
                      onKeyDown={onKeyDown}
                      aria-label={sellLabel(def.id, resale)}
                      onClick={(event) => act(event, def.id, () => sell(def.id))}
                      className={ACTION}
                    >
                      {copy('inventory.sell.button')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {gifts.length === 0 ? null : (
        <section aria-label={copy('inventory.gifts.heading')} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-bold text-ink-300 uppercase">
            {copy('inventory.gifts.heading')}
          </h3>
          <ul aria-busy={coolingDown} className="flex flex-col gap-1.5">
            {gifts.map(({ stack, def }) => {
              const resale = resaleValue(def, minute, minute, engineConfig)
              return (
                <li
                  key={def.id}
                  data-inventory-item={def.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-night-950/60 p-2"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-50">
                      {giftCountLine(def.id, stack.count)}
                    </p>
                    <p className="text-xs text-ink-300">{inventoryItemDetails(def.id)}</p>
                    <p className="text-xs text-ink-300">{resaleLine(resale)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onKeyDown={onKeyDown}
                      aria-label={giftOnSelfLabel(def.id)}
                      onClick={(event) =>
                        act(event, def.id, () =>
                          report(gameStore.getState().consumeGift(def.id, 'yourself'), def.id, () =>
                            giftUsedOnSelfNotice(def.id),
                          ),
                        )
                      }
                      className={ACTION}
                    >
                      {copy('inventory.gift.useButton')}
                    </button>
                    <button
                      type="button"
                      onKeyDown={onKeyDown}
                      aria-label={sellLabel(def.id, resale)}
                      onClick={(event) => act(event, def.id, () => sell(def.id))}
                      className={ACTION}
                    >
                      {copy('inventory.sell.button')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <PanelStatus text={result?.text ?? null} />
    </PanelDialog>
  )
}
