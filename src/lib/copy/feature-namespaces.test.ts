/**
 * Every reachable copy path renders with only the namespaces its own module graph registers
 * (S05c, DEC-11). Each test starts from a fresh module graph (vi.resetModules), imports one
 * feature module the way its lazy chunk does, then drives every data-driven key and every branch
 * through the active copy function: a missing `import '@/lib/copy/ns/<ns>'` throws
 * CopyNamespaceNotLoadedError (or a "No copy key" error) here instead of in front of a player.
 *
 * key-usage.test.ts checks the literal keys statically; this covers keys named by data (events,
 * venues, landmarks, boroughs, items, jobs, clout levels, homes, club doors) and keys picked at
 * run time (form errors, effect labels, rent notices, block reasons).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventEffect } from '@/lib/data/schemas/content'

beforeEach(() => {
  vi.resetModules()
})

/** The namespaces registered so far in this test's fresh module graph. */
async function registered(): Promise<string[]> {
  const { registeredNamespaces } = await import('./registry')
  return registeredNamespaces().sort()
}

describe('feature copy renders with only its own namespaces loaded', () => {
  it('a fresh graph starts with the boot namespaces only (self-check)', async () => {
    const { BOOT_NAMESPACES, copy, CopyNamespaceNotLoadedError } = await import('./index')
    expect(await registered()).toEqual([...BOOT_NAMESPACES].sort())
    expect(() => copy('events.ui.continue')).toThrow(CopyNamespaceNotLoadedError)
  })

  it('boot: every loading and retry label', async () => {
    const { ZoneLoading, ZoneLoadFailed } = await import('@/components/overlay/ZoneLoading')
    const loadingKeys = ['loading.welcome', 'loading.event', 'loading.place'] as const
    for (const labelKey of loadingKeys) {
      for (const zone of ['sheet', 'modal'] as const) {
        expect(renderToStaticMarkup(createElement(ZoneLoading, { zone, labelKey }))).toContain(
          'role="status"',
        )
      }
    }
    const failed = renderToStaticMarkup(
      createElement(ZoneLoadFailed, { zone: 'modal', onRetry() {} }),
    )
    expect(failed).toContain('Try again')
  })

  it('the event sheet chunk: every event text and every effect label', async () => {
    await import('@/components/events/EventSheet')
    const { effectLabel, effectsSummary, eventText } =
      await import('@/components/events/effectLabels')
    const { copy } = await import('./index')
    const { default: eventsJson } = await import('@data/events/events.json')
    for (const event of eventsJson.events) {
      expect(eventText(event.titleKey)).not.toBe('')
      expect(eventText(event.bodyKey)).not.toBe('')
      for (const choice of event.choices) {
        expect(eventText(choice.labelKey)).not.toBe('')
        expect(eventText(choice.resultKey)).not.toBe('')
        effectsSummary(choice.effects as readonly EventEffect[])
      }
    }
    const effects: EventEffect[] = [
      { kind: 'cash', amount: 5 },
      { kind: 'cash', amount: -5 },
      { kind: 'time', minutes: 30 },
      { kind: 'clout', amount: 3 },
      { kind: 'clout', amount: -3 },
      ...(['energy', 'hunger', 'mood'] as const).flatMap((stat) => [
        { kind: 'stat' as const, stat, amount: 4 },
        { kind: 'stat' as const, stat, amount: -4 },
      ]),
    ]
    for (const effect of effects) expect(effectLabel(effect)).not.toBe('')
    expect(copy('events.ui.cantAfford')).not.toBe('')
    expect(copy('events.ui.continue')).not.toBe('')
  })

  it('the place sheet chunk: every place renders, and every action, block and result reads', async () => {
    const { PlaceSheet } = await import('@/components/places/PlaceSheet')
    const copyFns = await import('@/lib/world/placeActionCopy')
    const { findPlace, landmarks, venues } = await import('@/lib/world/places')
    const { engineConfig } = await import('@/engine/config')
    const { initialSnapshot } = await import('@/engine/game')
    const { performPlaceAction, placeActions } = await import('@/engine/placeActions')

    const ids = [...venues, ...landmarks].map((place) => place.id)
    for (const placeId of ids) {
      expect(renderToStaticMarkup(createElement(PlaceSheet, { placeId }))).toContain(
        `data-place-sheet="${placeId}"`,
      )
    }

    const base = initialSnapshot(engineConfig)
    const minutes = [0, 6 * 60, 8 * 60, 13 * 60, 18 * 60, 22 * 60, 23 * 60 + 30]
    const players = [
      base.player,
      { ...base.player, cash: 0, clout: 0, stats: { ...base.player.stats, energy: 0 } },
      { ...base.player, cash: 1_000_000, clout: 1_000_000 },
    ]
    let blocks = 0
    let done = 0
    for (const placeId of ids) {
      const place = findPlace(placeId)
      if (place === undefined) throw new Error(`no place ${placeId}`)
      for (const minute of minutes) {
        for (const player of players) {
          const snapshot = { clock: { minute, remainderMs: 0 }, player }
          const view = placeActions(place, snapshot, engineConfig)
          if (view.kind === 'look-only') continue
          copyFns.placeHoursLine(view.hours)
          for (const action of view.actions) {
            copyFns.placeActionAccessibleName(action, place, snapshot)
            if (action.block !== null) {
              blocks += 1
              continue
            }
            const result = performPlaceAction(snapshot, place, action.id, engineConfig)
            if (result.ok) {
              done += 1
              copyFns.placeActionDone(result, place)
            } else if (result.error.code === 'BLOCKED') {
              copyFns.placeBlockReason(result.error.block, place)
            }
          }
        }
      }
    }
    // The sweep reached both branches (self-check).
    expect(blocks).toBeGreaterThan(0)
    expect(done).toBeGreaterThan(0)
  })

  it('the welcome chunk: the card, the lock notice and every form error', async () => {
    const { WelcomeCard } = await import('@/components/welcome/WelcomeCard')
    const { AgeLockNotice } = await import('@/components/welcome/AgeLockNotice')
    const { fieldErrors } = await import('@/lib/forms/errors')
    const { createWelcomeSchema, WELCOME_FIELDS } = await import('@/lib/forms/welcome')
    const { copy } = await import('./index')

    expect(
      renderToStaticMarkup(createElement(WelcomeCard, { titleId: 't', introId: 'i' })),
    ).toContain('id="t"')
    expect(
      renderToStaticMarkup(createElement(AgeLockNotice, { titleId: 't', bodyId: 'b' })),
    ).toContain('id="t"')

    const schema = createWelcomeSchema(2026, { birthYearSpan: 100 })
    const errors = fieldErrors(schema, { birthYear: 'x', consent: false, audio: '' })
    expect(Object.keys(errors).sort()).toEqual([...WELCOME_FIELDS].sort())
    for (const key of Object.values(errors)) if (key !== undefined) copy(key)
    // A well-formed year the picker does not offer takes the refine branch.
    const outOfRange = fieldErrors(schema, { birthYear: '1000', consent: true, audio: 'own' })
    expect(Object.keys(outOfRange)).toEqual(['birthYear'])
  })

  it('economy copy: every job, clout level, home and rent notice', async () => {
    const economy = await import('@/lib/economyCopy')
    const { engineConfig } = await import('@/engine/config')
    const { homeIds } = await import('@/engine/rent')
    const { default: jobsJson } = await import('@data/jobs/jobs.json')
    const levels = engineConfig.clout.levels.map((level) => level.id)
    const homes = homeIds(engineConfig)

    for (const job of jobsJson.jobs) {
      const jobId = job.id as Parameters<typeof economy.jobName>[0]
      economy.shiftLabel(jobId)
      for (const level of levels) {
        economy.jobLockedLabel({ jobId, requiredLevel: level, currentLevel: levels[0] ?? level })
      }
    }
    economy.shiftDone(56)
    for (const home of homes) {
      economy.homeRentLine(home)
      economy.nextRentDueLine(home, 7)
      for (const other of homes) economy.homeRentComparison(home, other)
    }
    const home = homes[0]
    if (home === undefined) throw new Error('no homes')
    const notices = [
      economy.rentNotice({ kind: 'paid', day: 7, home, rent: 100, arrears: 0 }),
      economy.rentNotice({ kind: 'paid', day: 7, home, rent: 100, arrears: 20 }),
      economy.rentNotice({ kind: 'arrears-paid', day: 7, amount: 20 }),
      economy.rentNotice({
        kind: 'missed',
        day: 7,
        home,
        owed: 100,
        lateFee: 0,
        missesBeforeEviction: 2,
      } as Parameters<typeof economy.rentNotice>[0]),
      economy.rentNotice({
        kind: 'missed',
        day: 7,
        home,
        owed: 100,
        lateFee: 10,
        missesBeforeEviction: 1,
      } as Parameters<typeof economy.rentNotice>[0]),
      economy.rentNotice({
        kind: 'evicted',
        day: 7,
        from: home,
        to: home,
      } as Parameters<typeof economy.rentNotice>[0]),
    ]
    for (const notice of notices) expect(notice).not.toBe('')
  })

  it('shop copy: every item, slot and rarity', async () => {
    const shop = await import('@/lib/shopCopy')
    const { engineConfig } = await import('@/engine/config')
    const { ITEM_SLOTS, isGift } = await import('@/engine/items')
    const { default: balanceJson } = await import('@data/config/balance.json')
    for (const item of engineConfig.items.catalog) {
      shop.itemName(item.id)
      shop.itemDescription(item.id)
      shop.buyLabel(item.id)
      shop.cannotAffordLabel(item.id, 0)
      shop.alreadyOwnedLabel(item.id)
      shop.boughtNotice(item.id, 10)
      shop.sellLabel(item.id, 5)
      shop.soldNotice(item.id, 5)
      if (isGift(item)) {
        shop.useGiftOnSelfLabel(item.id)
        shop.giftUsedOnSelfNotice(item.id)
        shop.giftCountLine(item.id, 2)
      }
      for (const slot of ITEM_SLOTS) {
        shop.equipLabel(item.id, slot)
        shop.unequipLabel(item.id, slot)
      }
    }
    for (const slot of ITEM_SLOTS) shop.slotName(slot)
    for (const rarity of balanceJson.rarityTiers) {
      shop.rarityName(rarity as Parameters<typeof shop.rarityName>[0])
    }
  })
})
