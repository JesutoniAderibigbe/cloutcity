import { describe, expect, it } from 'vitest'
import { createLogger, type LogRecord } from '@/lib/log'
import { createSafeJsonStorage } from './storage'
import {
  PersistedStateSchema,
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

const fresh = initialPersistedState()
const saveOf = (cash: number): PersistedState => ({ ...fresh, player: { ...fresh.player, cash } })

describe('game store persistence', () => {
  it('starts from the balance anchors', () => {
    const { store } = setup()
    const state = store().getState()
    expect(state.player).toEqual({
      cash: 150,
      stats: { energy: 100, hunger: 80, mood: 70 },
      clout: 0,
      home: 'queens-room',
      rent: { owed: 0, missed: 0 },
    })
    expect(state.clock).toEqual({ minute: 480, remainderMs: 0 })
    expect(state.speed).toBe(1)
  })

  it('persists state with the schema version on every change', () => {
    const { local, store } = setup()
    const game = store()
    expect(game.getState().performAction('bodega-breakfast').ok).toBe(true)
    const after = saved(local!) as { state: PersistedState; version: number }
    expect(after.version).toBe(STORE_VERSION)
    expect(after.state.player.cash).toBe(144)
    expect(after.state.clock.minute).toBe(500)
    expect(Object.keys(after.state).sort()).toEqual(['clock', 'player', 'speed'])
  })

  it('rehydrates a new store from what an earlier one saved', () => {
    const local = new MemoryStorage()
    const first = setup(local).store()
    first.getState().performAction('bodega-breakfast')
    first.getState().setSpeed(2)
    const reloaded = setup(local).store()
    expect(reloaded.persist.hasHydrated()).toBe(true)
    expect(reloaded.getState().player).toEqual(first.getState().player)
    expect(reloaded.getState().clock).toEqual(first.getState().clock)
    expect(reloaded.getState().speed).toBe(2)
    expect(typeof reloaded.getState().performAction).toBe('function')
  })

  it('migrates a v1 save: keeps cash, starts clock and stats fresh, and re-saves it', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: { player: { cash: 999 } }, version: 1 }))
    const { records, store } = setup(local)
    expect(store().getState().player).toEqual(saveOf(999).player)
    expect(saved(local)).toEqual({ state: saveOf(999), version: STORE_VERSION })
    expect(records.some((r) => r.level === 'info' && /upgraded/i.test(r.msg))).toBe(true)
  })

  it('migrates a save from an unknown older version to a fresh state and re-saves it', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: { money: 5 }, version: 0 }))
    const store = setup(local).store()
    expect(store.getState().player).toEqual(fresh.player)
    expect(saved(local)).toEqual({ state: fresh, version: STORE_VERSION })
  })

  it('does not load or overwrite a save from a newer build', () => {
    const local = new MemoryStorage()
    const newer = JSON.stringify({ state: saveOf(5000), version: STORE_VERSION + 1 })
    local.setItem(STORE_KEY, newer)
    const { records, store } = setup(local)
    expect(store().getState().player).toEqual(fresh.player)
    expect(local.getItem(STORE_KEY)).toBe(newer)
    expect(records.some((r) => r.level === 'warn' && /saved game/i.test(r.msg))).toBe(true)
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['the wrong envelope', JSON.stringify(['cash', 1])],
    ['negative cash', JSON.stringify({ state: saveOf(-5), version: STORE_VERSION })],
    [
      'a stat of the wrong type',
      JSON.stringify({
        state: {
          ...fresh,
          player: { ...fresh.player, stats: { ...fresh.player.stats, mood: 'high' } },
        },
        version: STORE_VERSION,
      }),
    ],
    ['a missing clock', JSON.stringify({ state: { ...saveOf(10), clock: undefined }, version: 2 })],
    [
      'a fractional clock minute',
      JSON.stringify({
        state: { ...fresh, clock: { minute: 1.5, remainderMs: 0 } },
        version: STORE_VERSION,
      }),
    ],
    ['unknown keys', JSON.stringify({ state: { ...fresh, admin: true }, version: STORE_VERSION })],
  ])('ignores %s and starts fresh', (_label, raw) => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, raw)
    const { records, store } = setup(local)
    expect(store().getState().player).toEqual(fresh.player)
    expect(records.some((r) => r.level === 'info' && /saved game/i.test(r.msg))).toBe(true)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })

  it('repairs individually invalid fields and keeps the rest of the progress', () => {
    const local = new MemoryStorage()
    const damaged = {
      clock: { minute: 2000, remainderMs: 'soon' },
      player: {
        cash: 777,
        stats: { energy: 140, hunger: -3, mood: 41.6 },
        clout: 12,
        home: 'penthouse',
        rent: { owed: 280, missed: 1.4 },
      },
      speed: 3,
    }
    local.setItem(STORE_KEY, JSON.stringify({ state: damaged, version: STORE_VERSION }))
    const { records, store } = setup(local)
    const { clock, player, speed } = store().getState()
    expect({ clock, player, speed }).toEqual({
      clock: { minute: 2000, remainderMs: 0 },
      player: {
        cash: 777,
        stats: { energy: 100, hunger: 0, mood: 42 },
        clout: 12,
        home: 'queens-room',
        rent: { owed: 280, missed: 1 },
      },
      speed: 1,
    })
    expect(records.some((r) => r.level === 'info' && /repaired/i.test(r.msg))).toBe(true)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })

  it('the fresh state fits the save schema', () => {
    expect(PersistedStateSchema.safeParse(fresh).success).toBe(true)
  })
})

describe('store actions call the engine', () => {
  it('tick advances the clock only while visible', () => {
    const { local, store } = setup()
    const game = store()
    game.getState().tick(60_000, false)
    expect(game.getState().clock.minute).toBe(480)
    expect(local!.getItem(STORE_KEY)).toBeNull()
    for (let i = 0; i < 12; i++) game.getState().tick(5000, true)
    expect(game.getState().clock.minute).toBe(490)
  })

  it('tick runs twice as fast at 2x', () => {
    const { store } = setup()
    const game = store()
    game.getState().setSpeed(2)
    for (let i = 0; i < 12; i++) game.getState().tick(5000, true)
    expect(game.getState().clock.minute).toBe(500)
  })

  it('rejects an unsupported speed', () => {
    const { store } = setup()
    const game = store()
    expect(() => game.getState().setSpeed(3)).toThrow(RangeError)
    expect(game.getState().speed).toBe(1)
  })

  it('performAction applies an ok result and leaves state alone on an error', () => {
    const { store } = setup()
    const game = store()
    const ok = game.getState().performAction('bodega-breakfast')
    expect(ok.ok).toBe(true)
    expect(game.getState().player.cash).toBe(144)
    const before = game.getState()
    const unknown = game.getState().performAction('teleport')
    expect(unknown).toEqual({ ok: false, error: { code: 'UNKNOWN_ACTION', actionId: 'teleport' } })
    expect(game.getState()).toBe(before)
  })

  it('reports insufficient funds without spending', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: saveOf(5), version: STORE_VERSION }))
    const game = setup(local).store()
    const result = game.getState().performAction('bodega-breakfast')
    expect(result).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', required: 6, available: 5 },
    })
    expect(game.getState().player.cash).toBe(5)
    expect(game.getState().clock.minute).toBe(480)
  })
})

describe('storage unavailable', () => {
  it('keeps working in memory when localStorage throws, and says so once at info', () => {
    const { records, store } = setup(new ThrowingStorage())
    const game = store()
    game.getState().performAction('bodega-breakfast')
    game.getState().performAction('bodega-breakfast')
    expect(game.getState().player.cash).toBe(138)
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
    game.getState().performAction('bodega-breakfast')
    expect(game.getState().player.cash).toBe(144)
    const { clock, player, speed } = game.getState()
    expect(storage.getItem(STORE_KEY)).toEqual({
      state: { clock, player, speed },
      version: STORE_VERSION,
    })
  })

  it('falls back to memory on the server, where there is no localStorage', () => {
    const { store } = setup(undefined)
    const game = store()
    game.getState().performAction('bodega-breakfast')
    expect(game.getState().player.cash).toBe(144)
  })

  it('switches to memory mid-session when a write starts failing', () => {
    const local = new MemoryStorage()
    const { records, store } = setup(local)
    const game = store()
    game.getState().performAction('bodega-breakfast')
    local.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    game.getState().performAction('bodega-breakfast')
    expect(game.getState().player.cash).toBe(138)
    expect(records.filter((r) => r.level === 'info')).toHaveLength(1)
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([])
  })
})

describe('S03 save edge cases through the persist middleware', () => {
  it('a v1 save with extra keys starts fresh and is replaced with a valid v2 save', () => {
    const local = new MemoryStorage()
    local.setItem(
      STORE_KEY,
      JSON.stringify({ state: { player: { cash: 999 }, extra: 1 }, version: 1 }),
    )
    const game = setup(local).store()
    expect(game.getState().player).toEqual(fresh.player)
    expect(saved(local)).toEqual({ state: fresh, version: STORE_VERSION })
  })

  it('a v1 save round-trips to v2 and back through a reload with cash intact', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: { player: { cash: 321 } }, version: 1 }))
    setup(local).store()
    const reloaded = setup(local).store()
    expect(reloaded.getState().player.cash).toBe(321)
    const envelope = saved(local) as { state: unknown; version: number }
    expect(envelope.version).toBe(STORE_VERSION)
    expect(PersistedStateSchema.safeParse(envelope.state).success).toBe(true)
  })

  it.each([
    ['a negative remainder', { minute: 500, remainderMs: -1 }],
    ['a remainder of a whole game minute', { minute: 500, remainderMs: 6000 }],
  ])(
    'repairs %s in a current-version save: the remainder resets, the minute is kept',
    (_label, clock) => {
      // Orchestrator ruling (S03 F3): repair an invalid field instead of discarding the save.
      const local = new MemoryStorage()
      local.setItem(
        STORE_KEY,
        JSON.stringify({
          state: { ...fresh, clock, player: { ...fresh.player, cash: 777 } },
          version: STORE_VERSION,
        }),
      )
      const game = setup(local).store()
      expect(game.getState().clock).toEqual({ minute: 500, remainderMs: 0 })
      expect(game.getState().player.cash).toBe(777)
    },
  )

  it('a newer-version save is neither loaded nor overwritten while the tab stays hidden', () => {
    const local = new MemoryStorage()
    const newer = JSON.stringify({ state: saveOf(5000), version: STORE_VERSION + 1 })
    local.setItem(STORE_KEY, newer)
    const game = setup(local).store()
    expect(game.getState().player.cash).toBe(fresh.player.cash)
    // Hidden ticks do not change state, so nothing is written.
    game.getState().tick(60_000, false)
    game.getState().tick(0, true)
    expect(local.getItem(STORE_KEY)).toBe(newer)
  })

  it('insufficient funds leaves the whole persisted state deep-equal and writes nothing', () => {
    const local = new MemoryStorage()
    const raw = JSON.stringify({ state: saveOf(5), version: STORE_VERSION })
    local.setItem(STORE_KEY, raw)
    const game = setup(local).store()
    const before = structuredClone({
      clock: game.getState().clock,
      player: game.getState().player,
      speed: game.getState().speed,
    })
    const writesBefore = local.getItem(STORE_KEY)
    expect(game.getState().performAction('bodega-breakfast').ok).toBe(false)
    const { clock, player, speed } = game.getState()
    expect({ clock, player, speed }).toEqual(before)
    expect(local.getItem(STORE_KEY)).toBe(writesBefore)
  })
})

describe('saving is guarded', () => {
  it('a newer-build save stays byte-identical through ticks and actions until discarded', () => {
    const local = new MemoryStorage()
    const newer = JSON.stringify({ state: saveOf(5000), version: STORE_VERSION + 1 })
    local.setItem(STORE_KEY, newer)
    const game = setup(local).store()
    expect(game.getState().newerSavePresent).toBe(true)
    game.getState().tick(1000, true)
    for (let i = 0; i < 20; i++) game.getState().tick(5000, true)
    expect(game.getState().performAction('bodega-breakfast').ok).toBe(true)
    game.getState().setSpeed(2)
    expect(game.getState().clock.minute).toBeGreaterThan(480)
    expect(local.getItem(STORE_KEY)).toBe(newer)
  })

  it('writes resume after discardNewerSaveAndStartFresh', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: saveOf(5000), version: STORE_VERSION + 1 }))
    const game = setup(local).store()
    game.getState().performAction('bodega-breakfast')
    game.getState().discardNewerSaveAndStartFresh()
    expect(game.getState().newerSavePresent).toBe(false)
    expect(saved(local)).toEqual({ state: fresh, version: STORE_VERSION })
    game.getState().performAction('bodega-breakfast')
    expect((saved(local) as { state: PersistedState }).state.player.cash).toBe(144)
  })

  it('a normal load is not flagged as a newer save', () => {
    const { store } = setup()
    expect(store().getState().newerSavePresent).toBe(false)
  })

  it('a tick that only moves the sub-minute remainder does not write', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: fresh, version: STORE_VERSION }))
    const before = local.getItem(STORE_KEY)
    const game = setup(local).store()
    game.getState().tick(1000, true)
    game.getState().tick(4000, true)
    expect(game.getState().clock).toEqual({ minute: 480, remainderMs: 5000 })
    expect(local.getItem(STORE_KEY)).toBe(before)
  })

  it('a tick that changes the minute writes', () => {
    const local = new MemoryStorage()
    local.setItem(STORE_KEY, JSON.stringify({ state: fresh, version: STORE_VERSION }))
    const game = setup(local).store()
    game.getState().tick(5000, true)
    game.getState().tick(1000, true)
    expect((saved(local) as { state: PersistedState }).state.clock).toEqual({
      minute: 481,
      remainderMs: 0,
    })
  })

  it('a speed change writes', () => {
    const { local, store } = setup()
    store().getState().setSpeed(2)
    expect((saved(local!) as { state: PersistedState }).state.speed).toBe(2)
  })
})

describe('jobs and rent in the store', () => {
  it('workShift credits the wage, moves the clock and persists the result', () => {
    const local = new MemoryStorage()
    const game = setup(local).store()
    const result = game.getState().workShift('barista')
    expect(result.ok && result.wage).toBe(56)
    expect(game.getState().player.cash).toBe(150 + 56)
    expect(game.getState().clock.minute).toBe(480 + 240)
    const after = saved(local) as { state: PersistedState }
    expect(after.state.player.cash).toBe(206)
  })

  it('workShift leaves state alone when the job is locked', () => {
    const game = setup().store()
    const before = game.getState()
    const result = game.getState().workShift('junior-dev')
    expect(result.ok === false && result.error.code).toBe('JOB_LOCKED')
    expect(game.getState()).toBe(before)
  })

  it('a v2 save keeps its progress and starts in the start home with nothing owed', () => {
    const local = new MemoryStorage()
    const v2 = {
      clock: { minute: 5000, remainderMs: 0 },
      player: { cash: 333, stats: { energy: 60, hunger: 50, mood: 40 } },
      speed: 1,
    }
    local.setItem(STORE_KEY, JSON.stringify({ state: v2, version: 2 }))
    const { player, clock } = setup(local).store().getState()
    expect(clock.minute).toBe(5000)
    expect(player).toEqual({
      ...v2.player,
      clout: 0,
      home: 'queens-room',
      rent: { owed: 0, missed: 0 },
    })
    expect((saved(local) as { version: number }).version).toBe(STORE_VERSION)
  })

  it('a rent change alone is a meaningful change that is written', () => {
    const local = new MemoryStorage()
    const owing = { ...fresh, player: { ...fresh.player, cash: 0 } }
    local.setItem(STORE_KEY, JSON.stringify({ state: owing, version: STORE_VERSION }))
    const game = setup(local).store()
    // Fast-forward to just before the first rent day, then let it pass.
    game.setState({ clock: { minute: 7 * 24 * 60 - 1, remainderMs: 0 } })
    // One game minute of passive time, in two ticks (each tick is capped at maxTickRealMs).
    game.getState().tick(3000, true)
    game.getState().tick(3000, true)
    expect(game.getState().clock.minute).toBe(7 * 24 * 60)
    const after = saved(local) as { state: PersistedState }
    expect(after.state.player.rent).toEqual({ owed: 280, missed: 1 })
  })
})

describe('jobs and rent in the store: guards', () => {
  it('a locked job writes nothing to storage', () => {
    const local = new MemoryStorage()
    const raw = JSON.stringify({ state: saveOf(150), version: STORE_VERSION })
    local.setItem(STORE_KEY, raw)
    const game = setup(local).store()
    const written = local.getItem(STORE_KEY)
    expect(game.getState().workShift('junior-dev').ok).toBe(false)
    expect(local.getItem(STORE_KEY)).toBe(written)
  })

  it('a shift without enough energy leaves state deep-equal and writes nothing', () => {
    const local = new MemoryStorage()
    const tired = {
      ...fresh,
      player: { ...fresh.player, stats: { ...fresh.player.stats, energy: 24 } },
    }
    local.setItem(STORE_KEY, JSON.stringify({ state: tired, version: STORE_VERSION }))
    const game = setup(local).store()
    const before = structuredClone({ clock: game.getState().clock, player: game.getState().player })
    const written = local.getItem(STORE_KEY)
    const result = game.getState().workShift('delivery')
    expect(result.ok === false && result.error.code).toBe('INSUFFICIENT_ENERGY')
    expect({ clock: game.getState().clock, player: game.getState().player }).toEqual(before)
    expect(local.getItem(STORE_KEY)).toBe(written)
  })

  it('an unknown job id changes nothing', () => {
    const game = setup().store()
    const before = game.getState()
    const result = game.getState().workShift('__proto__')
    expect(result.ok === false && result.error.code).toBe('UNKNOWN_JOB')
    expect(game.getState()).toBe(before)
  })

  it('a newer-build save stays byte-identical through shifts and rent', () => {
    const local = new MemoryStorage()
    const newer = JSON.stringify({ state: saveOf(5000), version: STORE_VERSION + 1 })
    local.setItem(STORE_KEY, newer)
    const game = setup(local).store()
    // The newer save is not loaded (fresh $150), so a shift across the first rent boundary
    // both pays a wage and misses rent: two state changes, neither written.
    game.setState({ clock: { minute: 7 * 24 * 60 - 60, remainderMs: 0 } })
    const result = game.getState().workShift('barista')
    expect(result.ok && result.rent.map((event) => event.kind)).toEqual(['missed'])
    expect(local.getItem(STORE_KEY)).toBe(newer)
  })

  it.each([
    ['__proto__', 'queens-room'],
    ['constructor', 'queens-room'],
    ['toString', 'queens-room'],
    ['manhattan-loft', 'manhattan-loft'],
  ])('a v3 save with home %j loads in %s', (home, expected) => {
    const local = new MemoryStorage()
    const raw = `{"state":{"clock":{"minute":900,"remainderMs":0},"player":{"cash":321,"stats":{"energy":50,"hunger":50,"mood":50},"clout":0,"home":${JSON.stringify(home)},"rent":{"owed":0,"missed":0}},"speed":1},"version":${STORE_VERSION}}`
    local.setItem(STORE_KEY, raw)
    const { player } = setup(local).store().getState()
    expect(player.home).toBe(expected)
    expect(player.cash).toBe(321)
    expect(Object.getPrototypeOf(player)).toBe(Object.prototype)
  })

  it('a v3 save with a string missed count keeps its progress and resets the count', () => {
    const local = new MemoryStorage()
    const tampered = {
      ...saveOf(321),
      player: { ...saveOf(321).player, rent: { owed: 280, missed: '2' } },
    }
    local.setItem(STORE_KEY, JSON.stringify({ state: tampered, version: STORE_VERSION }))
    const { player } = setup(local).store().getState()
    expect(player.cash).toBe(321)
    expect(player.rent).toEqual({ owed: 280, missed: 0 })
  })

  it.each([
    ['negative owed', { owed: -5, missed: 0 }],
    ['a missing rent object', undefined],
  ])('a v3 save with %s is unusable and starts fresh', (_label, rent) => {
    const local = new MemoryStorage()
    const tampered = { ...saveOf(321), player: { ...saveOf(321).player, rent } }
    local.setItem(STORE_KEY, JSON.stringify({ state: tampered, version: STORE_VERSION }))
    const { player } = setup(local).store().getState()
    expect(player).toEqual(fresh.player)
  })
})
