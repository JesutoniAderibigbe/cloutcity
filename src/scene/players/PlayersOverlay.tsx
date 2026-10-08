'use client'

/**
 * Real players, DOM side (S42 phase 1), loaded lazily by the canvas once the city is playable
 * (`cc-feature:players`, never precached). It starts presence for the page
 * (presenceRuntime.ts) and shows, like Lagos Life:
 *
 *  - the online count, `● N online` with a green dot, at the top of the map's free row under
 *    the HUD (the HUD itself has no free cell at 390 px), signed in or out;
 *  - a name tag over each real player drawn on the map, with a "Player" ring in the 3D layer
 *    (src/scene/players/layer.ts), so they never read as locals (UX-3);
 *  - the player card a tap opens: handle, clout level, their look's colours, and Mute, Block and
 *    Report (the shared PlayerActions; a block or mute hides them here at once).
 *
 * The keyboard and screen-reader path (A11Y-3) is "Players here", visible on focus, which opens
 * the card on the nearest drawn player; "Next player" steps through the others.
 *
 * Without a Supabase configuration nothing starts and nothing renders.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayerActions } from '@/components/safety/PlayerActions'
import { copy, type CopyKey } from '@/lib/copy'
import { formatCount } from '@/lib/format'
import { snakeToCamel } from '@/lib/copy/camel'
import { safetyApi, type SafetyApi } from '@/lib/supabase/safetyApi'
import { onPlaceOpened } from '@/state/placeSheet'
import {
  playersBridge,
  presenceStore,
  selectPlayer,
  setPlayerHidden,
  useOnlineCount,
  useSelectedPlayer,
  type PlayerCard,
} from '@/state/presence'
import { selectLocal, townsfolkStore } from '@/state/townsfolk'
import { FREE_SCENE_ROW_SELECTOR } from '../types'
import { lookColours } from './lookColors'
import { startPresence } from './presenceRuntime'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/players'
import '@/lib/copy/ns/clout'
import '@/lib/copy/ns/avatar'
import '@/lib/copy/ns/colors'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const PLAYERS_FEATURE = 'cc-feature:players'

/** The overlay grid's rows, read from the scene's own status grid (CitySceneClient.tsx). */
function overlayRows(): string {
  const row = document.querySelector<HTMLElement>(FREE_SCENE_ROW_SELECTOR)
  return row?.parentElement?.style.gridTemplateRows ?? ''
}

/**
 * The safety API with a local hide: a player this viewer blocks or mutes leaves the map at once
 * (the server keeps them out of every later snapshot), and an Undo brings them back.
 */
export function hidingSafetyApi(api: SafetyApi): SafetyApi {
  return {
    ...api,
    block: async (target) => {
      const result = await api.block(target)
      if (result.ok) {
        setPlayerHidden(target, true)
        selectPlayer(null)
      }
      return result
    },
    unblock: async (target, undoId) => {
      const result = await api.unblock(target, undoId)
      if (result.ok) setPlayerHidden(target, false)
      return result
    },
    mute: async (target) => {
      const result = await api.mute(target)
      if (result.ok) setPlayerHidden(target, true)
      return result
    },
    unmute: async (target) => {
      const result = await api.unmute(target)
      if (result.ok) setPlayerHidden(target, false)
      return result
    },
  }
}

const playersApi = hidingSafetyApi(safetyApi)

/** The clout ladder's name for a level id. */
const levelName = (level: PlayerCard['level']) =>
  copy(`clout.levels.${snakeToCamel(level)}.name` as CopyKey)

/** One name tag per drawn player, moved over their head each frame (one rAF loop, no React). */
function NameTags({ hidden }: { readonly hidden: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const layer = layerRef.current
    if (layer === null || hidden) return
    const tags = new Map<string, HTMLDivElement>()
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const { players } = presenceStore.getState()
      const heads = playersBridge.current?.heads() ?? []
      const seen = new Set<string>()
      for (const head of heads) {
        const handle = players.find((p) => p.id === head.id)?.handle ?? null
        if (handle === null) continue
        seen.add(head.id)
        let tag = tags.get(head.id)
        if (tag === undefined) {
          tag = document.createElement('div')
          tag.className = 'pointer-events-none fixed top-0 left-0'
          tag.dataset.playerTag = head.id
          const label = document.createElement('span')
          label.className =
            'block -translate-x-1/2 -translate-y-[130%] rounded-full bg-taxi px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-on-taxi shadow'
          tag.append(label)
          layer.append(tag)
          tags.set(head.id, tag)
        }
        const label = tag.firstElementChild
        if (label !== null && label.textContent !== handle) label.textContent = handle
        tag.style.transform = `translate(${head.x}px, ${head.y}px)`
      }
      for (const [id, tag] of tags) {
        if (seen.has(id)) continue
        tag.remove()
        tags.delete(id)
      }
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      for (const tag of tags.values()) tag.remove()
    }
  }, [hidden])
  return <div ref={layerRef} aria-hidden="true" data-player-tags="" />
}

/**
 * `● N online` with a green dot, like Lagos Life's top bar: at the top of the map's free row,
 * right under the HUD. Hidden while unknown, and at 0 (a signed-out visitor with nobody on).
 */
function OnlineChip() {
  const online = useOnlineCount()
  if (online === null || online === 0) return null
  const count = formatCount(online)
  return (
    <p
      data-online-count={online}
      role="status"
      aria-label={copy('players.onlineLabel', { count })}
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full glass px-3 text-xs font-bold whitespace-nowrap text-success shadow"
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-success" />
      <span aria-hidden="true">{copy('players.online', { count })}</span>
    </p>
  )
}

function Swatches({ card }: { readonly card: PlayerCard }) {
  const colours = lookColours(card.look)
  const parts = [
    ['skin', colours.skin],
    ['top', colours.top],
    ['bottom', colours.bottom],
    ['hair', colours.hair],
  ] as const
  return (
    <ul aria-label={copy('players.card.look')} className="mt-2 flex flex-wrap gap-1.5">
      {parts.map(([part, swatch]) => {
        const name = copy('players.card.swatch', {
          part: copy(`players.card.part.${part}`),
          colour: copy(swatch.nameKey),
        })
        return (
          <li
            key={part}
            className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-fg"
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full border border-line"
              style={{ backgroundColor: swatch.hex }}
            />
            {name}
          </li>
        )
      })}
    </ul>
  )
}

export default function PlayersOverlay({
  pins,
  hidden,
}: {
  /** Every place pin's id and borough (what presence announces). */
  readonly pins: readonly { readonly id: string; readonly borough: string }[]
  /** The apartment or creator has the screen: no tags or card over it. */
  readonly hidden: boolean
}) {
  const card = useSelectedPlayer()
  const [rows] = useState(overlayRows)
  const [empty, setEmpty] = useState(false)
  const [focusCard, setFocusCard] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const boroughOf = useMemo(() => new Map(pins.map((pin) => [pin.id, pin.borough])), [pins])

  useEffect(() => startPresence(boroughOf), [boroughOf])
  // One thing at a time: a place sheet or a local's card closes the player card.
  useEffect(() => onPlaceOpened(() => selectPlayer(null)), [])
  useEffect(
    () =>
      townsfolkStore.subscribe((state) => {
        if (state.selected !== null) selectPlayer(null)
      }),
    [],
  )
  useEffect(() => {
    if (card !== null && focusCard) headingRef.current?.focus()
  }, [card, focusCard])
  const open = card !== null
  useEffect(() => {
    const element = cardRef.current
    if (!open || element === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectPlayer(null)
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [open])

  const drawnIds = () => {
    const { players } = presenceStore.getState()
    return (playersBridge.current?.heads() ?? [])
      .map((head) => head.id)
      .filter((id) => players.some((p) => p.id === id && p.handle !== null))
  }
  const find = () => {
    const first = drawnIds()[0] ?? null
    setEmpty(first === null)
    setFocusCard(true)
    selectLocal(null)
    selectPlayer(first)
  }
  const next = () => {
    const ids = drawnIds()
    if (ids.length === 0) return
    const at = ids.indexOf(card?.id ?? '')
    setFocusCard(true)
    selectPlayer(ids[(at + 1) % ids.length] ?? null)
  }

  return (
    <>
      {hidden || rows === '' ? null : (
        <>
          <NameTags hidden={hidden} />
          <div
            data-cc-feature={PLAYERS_FEATURE}
            className="pointer-events-none absolute inset-0 grid grid-cols-1"
            style={{ gridTemplateRows: rows }}
          >
            <div className="players-row relative flex min-h-0 flex-col items-center justify-start gap-2 overflow-hidden px-3 pt-2">
              <div className="flex w-full justify-end">
                <OnlineChip />
              </div>
              <button
                type="button"
                onClick={find}
                data-players-find=""
                className="pointer-events-auto sr-only min-h-11 rounded-full glass px-4 text-sm font-semibold text-fg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-focus"
              >
                {copy('players.find')}
              </button>
              <p role="status" className="sr-only">
                {empty && card === null ? copy('players.none') : ''}
              </p>
              {card === null ? null : (
                <section
                  role="dialog"
                  aria-labelledby="player-card-name"
                  data-player-card={card.id}
                  ref={cardRef}
                  className="pointer-events-auto min-h-0 w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border-2 border-taxi glass p-3 shadow-lg"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-taxi text-lg font-bold text-on-taxi"
                    >
                      {card.handle.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2
                        id="player-card-name"
                        ref={headingRef}
                        tabIndex={-1}
                        className="truncate text-base font-bold text-fg focus:outline-none"
                        aria-label={copy('players.card.label', { handle: card.handle })}
                      >
                        @{card.handle}
                      </h2>
                      <p className="text-xs font-semibold text-muted">
                        <span className="rounded-full bg-taxi px-2 py-0.5 text-on-taxi">
                          {copy('players.card.badge')}
                        </span>{' '}
                        {copy('players.card.level', { level: levelName(card.level) })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectPlayer(null)}
                      aria-label={copy('players.card.close')}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl text-fg focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">{copy('players.card.real')}</p>
                  <Swatches card={card} />
                  <div className="mt-3">
                    <PlayerActions
                      key={card.id}
                      player={{ id: card.id, handle: card.handle }}
                      api={playersApi}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={next}
                    className="mt-2 min-h-11 w-full rounded-full border border-line px-4 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {copy('players.next')}
                  </button>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
