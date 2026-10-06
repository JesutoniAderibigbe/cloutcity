import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { initialSnapshot, type GameSnapshot } from '@/engine/game'
import { performPlaceAction, placeActions, type PlaceAction } from '@/engine/placeActions'
import { baseCopy, createCopy, slangPacks } from '@/lib/copy'
import { formatMoney } from '@/lib/format'
import {
  formatDuration,
  placeActionAccessibleName,
  placeActionDetails,
  placeActionDone,
  placeBlockReason,
  placeHoursLine,
} from './placeActionCopy'
import { findPlace, landmarks, venues } from './places'

const plain = { copy: createCopy(baseCopy, { id: 'none', strings: {} }) }
const nyc = { copy: createCopy(baseCopy, slangPacks.nyc ?? { id: 'none', strings: {} }) }

function snapshotAt(
  clock: string,
  overrides: { clout?: number; cash?: number } = {},
): GameSnapshot {
  const [h = 0, m = 0] = clock.split(':').map(Number)
  const base = initialSnapshot(engineConfig)
  return {
    clock: { minute: h * 60 + m, remainderMs: 0 },
    player: { ...base.player, clout: overrides.clout ?? 0, cash: overrides.cash ?? 150 },
  }
}

function place(id: string) {
  const found = findPlace(id)
  if (found === undefined) throw new Error(`no place ${id}`)
  return found
}

function actionAt(id: string, actionId: string, snapshot: GameSnapshot): PlaceAction {
  const view = placeActions(place(id), snapshot, engineConfig)
  const found = view.kind === 'actions' ? view.actions.find((a) => a.id === actionId) : undefined
  if (found === undefined) throw new Error(`no ${actionId} at ${id}`)
  return found
}

describe('formatDuration', () => {
  it.each([
    [15, '15 min'],
    [60, '1 h'],
    [240, '4 h'],
    [90, '1 h 30 min'],
  ])('%i minutes reads %s', (minutes, text) => {
    expect(formatDuration(minutes, plain)).toBe(text)
  })
})

describe('place action labels', () => {
  it('names the duration, price and gain with the shared money formatter', () => {
    const coffee = actionAt('steam-vent-coffee', 'coffee', snapshotAt('08:00'))
    const name = placeActionAccessibleName(
      coffee,
      place('steam-vent-coffee'),
      snapshotAt('08:00'),
      plain,
    )
    expect(name).toContain('Coffee: ')
    expect(name).toContain(formatMoney(coffee.def.cashCost))
  })

  it('a club night shows its cover and clout gain', () => {
    const night = snapshotAt('23:00', { clout: 100 })
    const action = actionAt('glowmatic', 'club-night', night)
    const details = placeActionDetails(action, night, plain)
    expect(details).toContain(
      `${formatMoney(engineConfig.place.clubs.glowmatic?.coverCharge ?? 0)} cover`,
    )
    expect(details).toMatch(/\+\d+ clout/)
  })

  it('a blocked action carries its reason in the accessible name', () => {
    const day = snapshotAt('12:00')
    const action = actionAt('glowmatic', 'club-night', day)
    const name = placeActionAccessibleName(action, place('glowmatic'), day, plain)
    expect(name).toMatch(/^Go in: .+\. Closed\. Opens at 22:00\.$/)
  })

  it('the club door refusal is in voice in the nyc pack and names the levels', () => {
    const night = snapshotAt('23:00')
    const action = actionAt('glowmatic', 'club-night', night)
    if (action.block === null) throw new Error('expected the door to refuse')
    const reason = placeBlockReason(action.block, place('glowmatic'), nyc)
    expect(reason).toContain('Bouncer checked the list')
    expect(reason).toContain('Local')
    expect(reason).toContain('Nobody')
  })

  it('a locked borough reason comes from the borough copy', () => {
    const action = actionAt('brickwave', 'club-night', snapshotAt('23:00'))
    if (action.block === null) throw new Error('expected a lock')
    expect(placeBlockReason(action.block, place('brickwave'), plain)).toMatch(/Brooklyn is locked/)
  })

  it('reports opening hours on the personal clock', () => {
    expect(placeHoursLine({ status: 'always' }, plain)).toBe('Open 24 hours')
    expect(placeHoursLine({ status: 'open', closesAt: '19:00' }, plain)).toBe('Open until 19:00')
    expect(placeHoursLine({ status: 'closed', opensAt: '22:00' }, plain)).toBe(
      'Closed. Opens at 22:00.',
    )
  })

  it('renders a label for every action at every real place without throwing', () => {
    for (const snapshot of [snapshotAt('08:00'), snapshotAt('23:00', { clout: 5000, cash: 0 })]) {
      for (const entry of [...venues, ...landmarks]) {
        const view = placeActions(entry, snapshot, engineConfig)
        if (view.kind !== 'actions') continue
        for (const action of view.actions) {
          for (const options of [plain, nyc]) {
            expect(placeActionAccessibleName(action, entry, snapshot, options)).not.toMatch(/[{}]/)
          }
        }
      }
    }
  })
})

describe('placeActionDone', () => {
  it('a visit names the place and the mood gain', () => {
    const result = performPlaceAction(
      snapshotAt('10:00'),
      place('flushing-meadows'),
      'visit',
      engineConfig,
    )
    if (!result.ok) throw new Error(result.error.code)
    expect(placeActionDone(result, place('flushing-meadows'), plain)).toMatch(
      /^You visited Flushing Meadows.*: \+\d+ mood\.$/,
    )
  })

  it('a club night reports the clout gain', () => {
    const result = performPlaceAction(
      snapshotAt('23:00', { clout: 100 }),
      place('glowmatic'),
      'club-night',
      engineConfig,
    )
    if (!result.ok) throw new Error(result.error.code)
    expect(placeActionDone(result, place('glowmatic'), plain)).toMatch(/\+\d+ clout\.$/)
  })
})

describe('a repeat club entry the same night (orchestrator ruling, S09)', () => {
  const night = snapshotAt('23:00', { clout: 100 })
  const first = performPlaceAction(night, place('glowmatic'), 'club-night', engineConfig)
  if (!first.ok) throw new Error(first.error.code)
  const repeat = performPlaceAction(first.snapshot, place('glowmatic'), 'club-night', engineConfig)
  if (!repeat.ok) throw new Error(repeat.error.code)

  it('says so in voice and in plain copy, with no clout in the effects', () => {
    expect(placeActionDone(repeat, place('glowmatic'), nyc)).toMatch(
      /^Back again\? You already made your name here tonight, so no extra clout\. \+\d+ mood\.$/,
    )
    expect(placeActionDone(repeat, place('glowmatic'), plain)).toMatch(
      /^You're in\. You already earned clout here tonight, so this visit adds none: \+\d+ mood\.$/,
    )
  })

  it('the button details say clout is already earned tonight', () => {
    const action = actionAt('glowmatic', 'club-night', repeat.snapshot)
    expect(placeActionDetails(action, repeat.snapshot, plain)).toMatch(
      /cover, \+\d+ mood, clout already earned here tonight$/,
    )
  })
})
