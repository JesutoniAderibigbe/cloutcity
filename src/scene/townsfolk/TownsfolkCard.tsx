'use client'

/**
 * A local's card (S04o): who the townsperson the player tapped on the map is (name, vibe), marked
 * "Local · Not a player" so NPCs are never taken for real players (UX-3), with a name tag that
 * follows them on the map. "Say hi" is shown disabled until NPC chat exists.
 *
 * It sits at the top of the free scene row (the map's own space between the HUD and the sheet,
 * like the map style chip), so it never covers a zone. The keyboard and screen-reader path
 * (A11Y-3) is "Meet the locals", visible on focus, which opens the card on the nearest local in
 * view; "Next local" steps through the others. Loaded lazily by the canvas once the city is
 * playable (`cc-feature:townsfolk-card`, never precached).
 */
import { useEffect, useRef, useState } from 'react'
import { copy, isCopyKey } from '@/lib/copy'
import { onPlaceOpened } from '@/state/placeSheet'
import { selectLocal, townsfolkBridge, useSelectedLocal } from '@/state/townsfolk'
import { FREE_SCENE_ROW_SELECTOR } from '../types'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/townsfolk'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const TOWNSFOLK_CARD_FEATURE = 'cc-feature:townsfolk-card'

/** The overlay grid's rows, read from the scene's own status grid (CitySceneClient.tsx). */
function overlayRows(): string {
  const row = document.querySelector<HTMLElement>(FREE_SCENE_ROW_SELECTOR)
  return row?.parentElement?.style.gridTemplateRows ?? ''
}

/** Keeps the name tag over the local's head while the card is open (one rAF loop, no React). */
function useNameTag(id: string | null) {
  const tagRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (id === null) return
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const tag = tagRef.current
      const head = townsfolkBridge.current?.headAt(id) ?? null
      if (tag === null) return
      tag.hidden = head === null
      if (head !== null) tag.style.transform = `translate(${head.x}px, ${head.y}px)`
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [id])
  return tagRef
}

export default function TownsfolkCard() {
  const local = useSelectedLocal()
  const [rows] = useState(overlayRows)
  const [empty, setEmpty] = useState(false)
  const [focusCard, setFocusCard] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const tagRef = useNameTag(local?.id ?? null)

  // One thing at a time: a place sheet opening closes the card.
  useEffect(() => onPlaceOpened(() => selectLocal(null)), [])
  useEffect(() => () => selectLocal(null), [])
  useEffect(() => {
    if (local !== null && focusCard) headingRef.current?.focus()
  }, [local, focusCard])
  // Escape closes the card. Listened to directly: jsx-a11y allows no key handler on a dialog.
  const open = local !== null
  useEffect(() => {
    const card = cardRef.current
    if (!open || card === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectLocal(null)
    }
    card.addEventListener('keydown', onKeyDown)
    return () => card.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (rows === '') return null

  const nearby = () => townsfolkBridge.current?.nearby() ?? []
  const meet = () => {
    const first = nearby()[0] ?? null
    setEmpty(first === null)
    setFocusCard(true)
    selectLocal(first)
  }
  const next = () => {
    const list = nearby()
    if (list.length === 0) return
    const at = list.findIndex((profile) => profile.id === local?.id)
    setFocusCard(true)
    selectLocal(list[(at + 1) % list.length] ?? null)
  }
  const vibeKey = local === null ? null : `townsfolk.vibe.${local.vibe}`

  return (
    <>
      <div
        data-cc-feature={TOWNSFOLK_CARD_FEATURE}
        className="pointer-events-none absolute inset-0 grid grid-cols-1"
        style={{ gridTemplateRows: rows }}
      >
        <div className="townsfolk-row flex min-h-0 flex-col items-center justify-start gap-2 overflow-hidden px-3 pt-2">
          <button
            type="button"
            onClick={meet}
            data-townsfolk-meet=""
            className="pointer-events-auto sr-only min-h-11 rounded-full glass px-4 text-sm font-semibold text-fg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-focus"
          >
            {copy('townsfolk.meet')}
          </button>
          <p role="status" className="sr-only">
            {empty && local === null ? copy('townsfolk.none') : ''}
          </p>
          {local === null ? null : (
            <section
              role="dialog"
              aria-labelledby="townsfolk-card-name"
              data-townsfolk-card={local.id}
              ref={cardRef}
              className="pointer-events-auto w-full max-w-sm rounded-2xl border border-line glass p-3 shadow-lg"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-taxi text-lg font-bold text-on-taxi"
                >
                  {local.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    id="townsfolk-card-name"
                    ref={headingRef}
                    tabIndex={-1}
                    className="truncate text-base font-bold text-fg focus:outline-none"
                    aria-label={copy('townsfolk.card.label', { name: local.name })}
                  >
                    {local.name}
                  </h2>
                  <p className="text-xs font-semibold text-muted">
                    <span className="rounded-full border border-line px-2 py-0.5 text-fg">
                      {copy('townsfolk.card.badge')}
                    </span>{' '}
                    {copy('townsfolk.card.notPlayer')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => selectLocal(null)}
                  aria-label={copy('townsfolk.card.close')}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl text-fg focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              {vibeKey !== null && isCopyKey(vibeKey) ? (
                <p className="mt-2 text-sm text-fg">{copy(vibeKey)}</p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled
                  aria-label={copy('townsfolk.card.sayHiSoon')}
                  className="min-h-11 flex-1 rounded-full border border-line px-4 text-sm font-semibold text-muted"
                >
                  {copy('townsfolk.card.sayHi')}{' '}
                  <span className="text-xs">· {copy('townsfolk.card.soon')}</span>
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="min-h-11 rounded-full bg-taxi px-4 text-sm font-semibold text-on-taxi focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {copy('townsfolk.card.next')}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
      {local === null ? null : (
        // The name tag: a fixed box moved over the local's head each frame.
        <div
          ref={tagRef}
          aria-hidden="true"
          hidden
          className="pointer-events-none fixed top-0 left-0"
          data-townsfolk-tag=""
        >
          <span className="block -translate-x-1/2 -translate-y-full rounded-full glass px-2 py-0.5 text-xs font-bold whitespace-nowrap text-fg shadow">
            {local.name}
          </span>
        </div>
      )}
    </>
  )
}
