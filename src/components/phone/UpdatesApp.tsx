'use client'

import { useMemo } from 'react'
import { eventText } from '@/components/events/effectLabels'
import { calendar } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import { findEvent } from '@/engine/events'
import { rentFor } from '@/engine/rent'
import { copy } from '@/lib/copy'
import { rentNotice } from '@/lib/economyCopy'
import { formatCount, formatGameTime, formatMoney } from '@/lib/format'
import { goalName } from '@/lib/goalsCopy'
import { phoneConfig } from '@/lib/phone/phoneConfig'
import { phoneUpdates, type UpdateItem } from '@/lib/phone/updates'
import { openCreator } from '@/state/creatorOpen'
import { hudPanelStore, openHudPanel } from '@/state/hudPanel'
import { useGameStore } from '@/state/store'
import { PHONE_SECONDARY } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

interface Row {
  readonly key: string
  readonly icon: string
  readonly text: string
  readonly when?: string
  readonly action?: { readonly label: string; readonly run: () => void }
}

function whenLine(minute: number): string {
  const { day, minuteOfDay } = calendar(minute, engineConfig)
  return copy('phone.updates.eventWhen', {
    day: formatCount(day),
    time: formatGameTime(minuteOfDay),
  })
}

/** One inbox item as a row: its icon, its text in the game's voice and what it opens. */
function rowFor(item: UpdateItem, home: Parameters<typeof rentFor>[0]): Row | null {
  switch (item.kind) {
    case 'goal':
      return {
        key: `goal:${item.goalId}`,
        icon: '🏆',
        text: copy('phone.updates.goal', { goal: goalName(item.goalId) }),
        action: {
          label: copy('phone.updates.goalAction'),
          run: () => openHudPanel('goals', { fromPhone: true }),
        },
      }
    case 'rent-owed':
      return {
        key: 'rent-owed',
        icon: '🧾',
        text: copy('phone.updates.rentOwed', { owed: formatMoney(item.owed) }),
        action: {
          label: copy('phone.updates.rentAction'),
          run: () => hudPanelStore.setState({ phoneApp: 'bank' }),
        },
      }
    case 'creator':
      return {
        key: 'creator',
        icon: '✨',
        text: copy('phone.updates.creator'),
        action: { label: copy('phone.updates.creatorAction'), run: openCreator },
      }
    case 'rent-notice':
      return { key: 'rent-notice', icon: '🏠', text: rentNotice(item.event) }
    case 'rent-due':
      return {
        key: 'rent-due',
        icon: '📅',
        text: copy('phone.updates.rentDue', {
          rent: formatMoney(rentFor(home, engineConfig)),
          day: formatCount(item.day),
        }),
      }
    case 'event': {
      const event = findEvent(item.eventId, engineConfig)
      if (event === undefined) return null
      return {
        key: `event:${item.eventId}`,
        icon: '🗽',
        text: copy('phone.updates.event', { event: eventText(event.titleKey) }),
        when: whenLine(item.at),
      }
    }
  }
}

/**
 * The Updates app (S58, S47 lite): one inbox of what the game already tells the player
 * elsewhere (src/lib/phone/updates.ts), "Needs you" first. Nothing here is invented, and a fresh
 * game shows little more than the next rent (GR-9); only "Needs you" items count toward the
 * phone's capped badge (GR-21).
 */
export function UpdatesApp() {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const goals = useGameStore((state) => state.goals)
  const grants = useGameStore((state) => state.grants)
  const prestige = useGameStore((state) => state.prestige)
  const events = useGameStore((state) => state.events)
  const creator = useGameStore((state) => state.creator)
  const lastRentEvent = useGameStore((state) => state.lastRentEvent)
  const updates = useMemo(
    () =>
      phoneUpdates(
        {
          save: { clock, player, goals, grants, prestige, events, creator },
          lastRentEvent,
          maxEvents: phoneConfig.updates.maxEvents,
        },
        engineConfig,
      ),
    [clock, player, goals, grants, prestige, events, creator, lastRentEvent],
  )
  const rows = (items: readonly UpdateItem[]) =>
    items.flatMap((item) => rowFor(item, player.home) ?? [])
  const needsYou = rows(updates.needsYou)
  const recent = rows(updates.recent)

  return (
    <div data-cc-feature="cc-feature:phone-updates" className="flex flex-col gap-4">
      {needsYou.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-3 text-sm font-semibold text-fg">
          {copy('phone.updates.empty')}
        </p>
      ) : (
        <RowList title={copy('phone.updates.needsYou')} rows={needsYou} accent />
      )}
      <RowList title={copy('phone.updates.recent')} rows={recent} />
    </div>
  )
}

function RowList({
  title,
  rows,
  accent = false,
}: {
  readonly title: string
  readonly rows: readonly Row[]
  readonly accent?: boolean
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold text-muted uppercase">{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.key}
            data-update={row.key}
            className={`flex items-start gap-3 rounded-2xl border bg-surface p-3 ${
              accent ? 'border-taxi' : 'border-line'
            }`}
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-canvas text-lg leading-none"
            >
              {row.icon}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-sm text-fg">{row.text}</p>
              {row.when === undefined ? null : <p className="text-xs text-muted">{row.when}</p>}
              {row.action === undefined ? null : (
                <button
                  type="button"
                  onClick={row.action.run}
                  className={`${PHONE_SECONDARY} self-start`}
                >
                  {row.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
