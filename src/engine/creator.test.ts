/**
 * The creator (S16a): the offer after the first action (after the tour), the step registry, the
 * rolls (committed before the reveal, one per scope) and moving into the rolled neighborhood.
 */
import { describe, expect, it } from 'vitest'
import { engineConfig as config, type EngineConfig } from './config'
import {
  commitRoll,
  completeCreator,
  creatorOfferShowing,
  creatorSteps,
  dismissCreatorOffer,
  initialCreatorState,
  moveIntoNeighborhood,
  noteCreatorAction,
  skipCreatorStep,
} from './creator'
import { createRng, type Rng } from './rng'
import { initialSave, type SaveState } from './save'

const save = initialSave(config)

/** A generator that fails the test if anything draws from it. */
const noDraws: Rng = {
  next() {
    throw new Error('drew from the generator')
  },
  state: 0,
}

describe('the offer', () => {
  it('is never due before the first action, and due after it', () => {
    expect(creatorOfferShowing(initialCreatorState, { tourActive: false }, config)).toBe(false)
    const after = noteCreatorAction(initialCreatorState, 512, config)
    expect(after.offeredAt).toBe(512)
    expect(creatorOfferShowing(after, { tourActive: false }, config)).toBe(true)
    expect(noteCreatorAction(after, 600, config)).toBe(after)
  })

  it('waits for the tour, and counts actions when the config asks for more than one', () => {
    const due = noteCreatorAction(initialCreatorState, 10, config)
    expect(creatorOfferShowing(due, { tourActive: true }, config)).toBe(false)
    const twice: EngineConfig = { ...config, creator: { ...config.creator, offerAfterActions: 2 } }
    const one = noteCreatorAction(initialCreatorState, 10, twice)
    expect(one).toEqual({ ...initialCreatorState, actions: 1 })
    expect(noteCreatorAction(one, 20, twice)).toMatchObject({ actions: 2, offeredAt: 20 })
  })

  it('closes when skipped or finished; skipped steps are recorded once', () => {
    const due = noteCreatorAction(initialCreatorState, 10, config)
    const dismissed = dismissCreatorOffer(due, 11)
    expect(creatorOfferShowing(dismissed, { tourActive: false }, config)).toBe(false)
    expect(dismissCreatorOffer(dismissed, 50).dismissedAt).toBe(11)
    const done = completeCreator(due, 30)
    expect(creatorOfferShowing(done, { tourActive: false }, config)).toBe(false)
    expect(completeCreator(done, 40).completedAt).toBe(30)
    const skipped = skipCreatorStep(skipCreatorStep(due, 'traits', config), 'traits', config)
    expect(skipped.skippedSteps).toEqual(['traits'])
    expect(skipCreatorStep(due, 'origin', config)).toBe(due)
    expect(skipCreatorStep(due, 'nonsense', config)).toBe(due)
  })
})

describe('step registry (D18)', () => {
  it('leaves the disabled origin seam out; S44 flips the flag to add it', () => {
    expect(creatorSteps(config)).toEqual(['look', 'traits', 'dream', 'neighborhood', 'home'])
    const withOrigin: EngineConfig = {
      ...config,
      creator: {
        ...config.creator,
        steps: config.creator.steps.map((step) =>
          step.id === 'origin' ? { ...step, enabled: true } : step,
        ) as EngineConfig['creator']['steps'],
      },
    }
    expect(creatorSteps(withOrigin)).toEqual([
      'look',
      'traits',
      'dream',
      'origin',
      'neighborhood',
      'home',
    ])
  })
})

describe('commitRoll', () => {
  const ids = config.neighborhoods.map((n) => n.id)

  it('draws a neighborhood once and writes it to the save before anything is shown', () => {
    const result = commitRoll(save, 'neighborhood', createRng(7), config)
    if (!result.ok) throw new Error(result.error.code)
    expect(result.replayed).toBe(false)
    expect(ids).toContain(result.roll.result)
    expect(result.save.rolls.neighborhood).toEqual({
      result: result.roll.result,
      at: save.clock.minute,
      run: 1,
    })
  })

  it('is idempotent: a second roll, or one after a reload, replays without drawing', () => {
    const first = commitRoll(save, 'neighborhood', createRng(7), config)
    if (!first.ok) throw new Error(first.error.code)
    const reloaded = JSON.parse(JSON.stringify(first.save)) as SaveState
    const again = commitRoll(reloaded, 'neighborhood', noDraws, config)
    expect(again).toEqual({ ok: true, save: reloaded, roll: first.roll, replayed: true })
  })

  it('a save-scoped roll holds through prestige (a later run)', () => {
    const first = commitRoll(save, 'neighborhood', createRng(1), config)
    if (!first.ok) throw new Error(first.error.code)
    const nextRun = { ...first.save, goals: { ...first.save.goals, run: 2 } }
    const again = commitRoll(nextRun, 'neighborhood', noDraws, config)
    expect(again.ok && again.replayed).toBe(true)
  })

  it('a run-scoped roll is drawn again in a new run (S44 origin seam)', () => {
    const perRun: EngineConfig = {
      ...config,
      creator: { ...config.creator, rolls: { neighborhood: { scope: 'run' } } },
    }
    const first = commitRoll(save, 'neighborhood', createRng(1), perRun)
    if (!first.ok) throw new Error(first.error.code)
    const sameRun = commitRoll(first.save, 'neighborhood', noDraws, perRun)
    expect(sameRun.ok && sameRun.replayed).toBe(true)
    const nextRun = { ...first.save, goals: { ...first.save.goals, run: 2 } }
    const again = commitRoll(nextRun, 'neighborhood', createRng(2), perRun)
    expect(again.ok && !again.replayed && again.roll.run === 2).toBe(true)
  })

  it('refuses a roll the creator does not make, and one with nothing to draw from', () => {
    expect(commitRoll(save, 'origin', noDraws, config)).toEqual({
      ok: false,
      error: { code: 'ROLL_DISABLED', kind: 'origin' },
    })
    expect(commitRoll(save, 'lottery', noDraws, config)).toEqual({
      ok: false,
      error: { code: 'ROLL_DISABLED', kind: 'lottery' },
    })
    const originOn: EngineConfig = {
      ...config,
      creator: { ...config.creator, rolls: { ...config.creator.rolls, origin: { scope: 'run' } } },
    }
    expect(commitRoll(save, 'origin', noDraws, originOn)).toEqual({
      ok: false,
      error: { code: 'EMPTY_POOL', kind: 'origin' },
    })
  })

  it('lands on every neighborhood for some seed (no dead entries in the pool)', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      const result = commitRoll(save, 'neighborhood', createRng(seed), config)
      if (result.ok) seen.add(result.roll.result)
    }
    expect([...seen].sort()).toEqual([...ids].sort())
  })
})

describe('moveIntoNeighborhood', () => {
  const rolled = (() => {
    const result = commitRoll(save, 'neighborhood', createRng(3), config)
    if (!result.ok) throw new Error(result.error.code)
    return result
  })()

  it('needs the roll first', () => {
    expect(moveIntoNeighborhood(save, 'queens-room', config)).toEqual({
      ok: false,
      error: { code: 'NOT_ROLLED' },
    })
  })

  it('settles the player in the rolled neighborhood with their current startable home', () => {
    const result = moveIntoNeighborhood(rolled.save, 'queens-room', config)
    if (!result.ok) throw new Error(result.error.code)
    expect(result.save.player.neighborhood).toBe(rolled.roll.result)
    expect(result.save.player.location).toEqual(save.player.location)
  })

  it('refuses a home the neighborhood does not have, or one the player does not live in', () => {
    expect(moveIntoNeighborhood(rolled.save, 'brooklyn-1br', config)).toMatchObject({
      ok: false,
      error: { code: 'HOME_NOT_HERE' },
    })
    const moved = {
      ...rolled.save,
      player: { ...rolled.save.player, home: 'brooklyn-1br' as const },
    }
    expect(moveIntoNeighborhood(moved, 'queens-room', config)).toEqual({
      ok: false,
      error: { code: 'NOT_YOUR_HOME', home: 'queens-room' },
    })
  })
})
