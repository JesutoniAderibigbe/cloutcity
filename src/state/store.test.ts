import { describe, expect, it } from 'vitest'
import { createLogger, type LogRecord } from '@/lib/log'
import { createSafeJsonStorage } from './storage'
import {
  STORE_KEY,
  STORE_VERSION,
  createGameStore,
  initialPersistedState,
  type PersistedState,
} from './store'

/** A minimal in-memory Web Storage, standing in for window.localStorage. */
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

/** Throws on every access, like Safari private mode or blocked site data. */
class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException('denied', 'SecurityError')
  }
  override setItem(): void {
    throw new DOMException('full', 'QuotaExceededError')
  }
}

function setup(local: Storage | undefined = new MemoryStorage()) {
  const records: LogRecord[] = []
  const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) })
  const storage = createSafeJsonStorage<PersistedState>(() => local, logger)
  return { local, records, logger, store: () => createGameStore(storage, logger) }
}

const saved = (local: Storage) => JSON.parse(local.getItem(STORE_KEY) ?? 'null') as unknown

describe('game store persistence', () => {
  it('starts from the balance anchors', () => {
    const { store } = setup()
    expect(store().getState().player).toEqual({ cash: 150 })
  })

  it('persists state with the schema version on every change', () => {
    const { local, store } = setup()
    store().getState().setCash(420)
    expect(saved(local!)).toEqual({ state: { player: { cash: 420 } }, version: STORE_VERSION })
  })

  it('rehydrates a new store from what an earlier one saved', () => {
    const local = new MemoryStorage()
    setup(local).store().getState().setCash(999)
    const reloaded = setup(local).store()
    expect(reloaded.persist.hasHydrated()).toBe(true)
    expect(reloaded.getState().player.cash).toBe(999)
    expect(typeof reloaded.getState().setCash).toBe('function')
  })

  it('migrates a save from an older version to a fresh state and re-saves it', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: { money: 5 }, version: 0 }))
    const store = setup(local).store()
    expect(store.getState().player).toEqual(initialPersistedState().player)
    expect(saved(local)).toEqual({ state: initialPersistedState(), version: STORE_VERSION })
  })

  it('does not load or overwrite a save from a newer build', () => {
    const local = new MemoryStorage()
    const newer = JSON.stringify({ state: { player: { cash: 5000 } }, version: STORE_VERSION + 1 })
    local.setItem(STORE_KEY, newer)
    const { records, store } = setup(local)
    expect(store().getState().player).toEqual(initialPersistedState().player)
    expect(local.getItem(STORE_KEY)).toBe(newer)
    expect(records.some((r) => r.level === 'warn' && /saved game/i.test(r.msg))).toBe(true)
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['the wrong envelope', JSON.stringify(['cash', 1])],
    [
      'state that fails the schema',
      JSON.stringify({ state: { player: { cash: -5 } }, version: 1 }),
    ],
    ['unknown keys', JSON.stringify({ state: { player: { cash: 1 }, admin: true }, version: 1 })],
  ])('ignores %s and starts fresh', (_label, raw) => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, raw)
    const { records, store } = setup(local)
    expect(store().getState().player).toEqual(initialPersistedState().player)
    expect(records.some((r) => r.level === 'info' && /saved game/i.test(r.msg))).toBe(true)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })

  it('rejects invalid cash instead of saving it', () => {
    const { local, store } = setup()
    const game = store()
    expect(() => game.getState().setCash(-1)).toThrow()
    expect(() => game.getState().setCash(1.5)).toThrow()
    expect(game.getState().player.cash).toBe(150)
    expect(local!.getItem(STORE_KEY)).toBeNull()
  })
})

describe('storage unavailable', () => {
  it('keeps working in memory when localStorage throws, and says so once at info', () => {
    const { records, store } = setup(new ThrowingStorage())
    const game = store()
    game.getState().setCash(300)
    game.getState().setCash(301)
    expect(game.getState().player.cash).toBe(301)
    expect(records.filter((r) => r.level === 'info')).toHaveLength(1)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })

  it('keeps working when accessing localStorage itself throws', () => {
    const records: LogRecord[] = []
    const logger = createLogger({ sink: (record) => records.push(record) })
    const storage = createSafeJsonStorage<PersistedState>(() => {
      throw new DOMException('denied', 'SecurityError')
    }, logger)
    const game = createGameStore(storage, logger)
    game.getState().setCash(7)
    expect(game.getState().player.cash).toBe(7)
    expect(storage.getItem(STORE_KEY)).toEqual({ state: { player: { cash: 7 } }, version: 1 })
  })

  it('falls back to memory on the server, where there is no localStorage', () => {
    const { store } = setup(undefined)
    const game = store()
    game.getState().setCash(10)
    expect(game.getState().player.cash).toBe(10)
  })

  it('switches to memory mid-session when a write starts failing', () => {
    const local = new MemoryStorage()
    const { records, store } = setup(local)
    const game = store()
    game.getState().setCash(200)
    local.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    game.getState().setCash(250)
    expect(game.getState().player.cash).toBe(250)
    expect(records.filter((r) => r.level === 'info')).toHaveLength(1)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })
})
