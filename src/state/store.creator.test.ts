/** The creator through the store (S16a): the offer, the choices, the roll, and what persists. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookProblem } from '@/engine/appearance'
import { engineConfig } from '@/engine/config'
import { creatorOfferShowing } from '@/engine/creator'
import { createLogger } from '@/lib/log'
import { creatorActions } from './creatorActions'
import { createSafeJsonStorage } from './storage'
import { createGameStore, STORE_KEY, type PersistedState } from './store'

const seeds = vi.hoisted(() => ({ next: 0 }))
vi.mock('./randomSeed', () => ({ randomSeed: () => ++seeds.next }))

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const logger = createLogger({ level: 'error', sink: () => {} })
const storeOn = (local: Storage) =>
  createGameStore(
    createSafeJsonStorage<PersistedState>(() => local, logger),
    logger,
  )
const saved = (local: Storage) =>
  (JSON.parse(local.getItem(STORE_KEY) ?? 'null') as { state: PersistedState } | null)?.state

beforeEach(() => {
  seeds.next = 0
})

describe('a new game', () => {
  it('starts with a random valid look from a fresh seed, and never with the creator offered', () => {
    const first = storeOn(new MemoryStorage()).getState()
    const second = storeOn(new MemoryStorage()).getState()
    expect(lookProblem(first.player.look, engineConfig)).toBeNull()
    expect(second.player.look).not.toEqual(first.player.look)
    expect(creatorOfferShowing(first.creator, { tourActive: false }, engineConfig)).toBe(false)
  })
})

describe('the creator offer', () => {
  it('is due after the first action, waits for the tour, and stays closed once skipped', () => {
    const game = storeOn(new MemoryStorage())
    expect(game.getState().performAction('bodega-breakfast').ok).toBe(true)
    const { creator } = game.getState()
    expect(creator.offeredAt).toBe(game.getState().clock.minute)
    expect(creatorOfferShowing(creator, { tourActive: true }, engineConfig)).toBe(false)
    expect(creatorOfferShowing(creator, { tourActive: false }, engineConfig)).toBe(true)
    creatorActions(game).dismissOffer()
    expect(creatorOfferShowing(game.getState().creator, { tourActive: false }, engineConfig)).toBe(
      false,
    )
  })

  it('a refused action does not count', () => {
    const game = storeOn(new MemoryStorage())
    expect(game.getState().workShift('junior-dev').ok).toBe(false)
    expect(game.getState().creator.offeredAt).toBeNull()
  })
})

describe('creator choices', () => {
  it('sets the look, traits and Dream, and they persist', () => {
    const local = new MemoryStorage()
    const game = storeOn(local)
    const creator = creatorActions(game)
    const look = creator.surpriseLook()
    expect(game.getState().player.look).not.toBe(look)
    expect(creator.chooseLook(look).ok).toBe(true)
    expect(creator.chooseTraits(['easygoing', 'thrifty']).ok).toBe(true)
    expect(creator.chooseCareer('influencer').ok).toBe(true)
    creator.skipStep('home')
    creator.complete()
    const state = saved(local)
    expect(state?.player.look).toEqual(look)
    expect(state?.player.traits).toEqual(['easygoing', 'thrifty'])
    expect(state?.player.careerPath).toBe('influencer')
    expect(state?.creator.skippedSteps).toEqual(['home'])
    expect(state?.creator.completedAt).toBe(game.getState().clock.minute)
  })

  it('refuses a free-text look and leaves the state as it was', () => {
    const game = storeOn(new MemoryStorage())
    const before = game.getState().player
    expect(creatorActions(game).chooseLook({ name: 'Ana' }).ok).toBe(false)
    expect(game.getState().player).toBe(before)
  })
})

describe('the neighborhood roll', () => {
  it('is saved before it is returned, replays after a reload, and lets the player move in', () => {
    const local = new MemoryStorage()
    const game = storeOn(local)
    const rolled = creatorActions(game).rollNeighborhood()
    if (!rolled.ok) throw new Error(rolled.error.code)
    expect(rolled.replayed).toBe(false)
    expect(saved(local)?.rolls.neighborhood).toEqual(rolled.roll)

    const reloaded = storeOn(local)
    const again = creatorActions(reloaded).rollNeighborhood()
    expect(again.ok && again.replayed && again.roll).toEqual(rolled.roll)

    const moved = creatorActions(reloaded).moveIntoNeighborhood('queens-room')
    if (!moved.ok) throw new Error(moved.error.code)
    expect(saved(local)?.player.neighborhood).toBe(rolled.roll.result)
    expect(reloaded.getState().player.location).toEqual({ kind: 'home' })
  })
})
