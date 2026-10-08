import { describe, expect, it } from 'vitest'
import accountJson from '@data/config/account.json'
import { initialSave } from '@/engine/save'
import { engineConfig } from '@/engine/config'
import { createLogger } from '@/lib/log'
import {
  ACCOUNT_KEY,
  INITIAL_ACCOUNT,
  createAccountStore,
  savePromptDue,
  upgradePending,
  type PersistedAccount,
} from './account'
import { createSafeJsonStorage } from './storage'

class MemoryStorage {
  readonly map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

const logger = createLogger({ sink: () => {} })
const storeOn = (memory: MemoryStorage) =>
  createAccountStore(
    createSafeJsonStorage<PersistedAccount>(() => memory as unknown as Storage, logger),
    logger,
  )

describe('the account flags on this device (S19)', () => {
  it('starts with nothing dismissed, not signed out and no link out', () => {
    const store = storeOn(new MemoryStorage())
    expect(store.getState()).toMatchObject(INITIAL_ACCOUNT)
  })

  it('persists the flags and never an email', () => {
    const memory = new MemoryStorage()
    const store = storeOn(memory)
    store.getState().dismissPrompt()
    store.getState().setSignedOut(true)
    store.getState().setPendingUpgrade(1234)
    const raw = memory.getItem(ACCOUNT_KEY) ?? ''
    expect(JSON.parse(raw)).toEqual({
      state: { promptDismissed: true, signedOut: true, pendingUpgradeAt: 1234 },
      version: 1,
    })
    expect(storeOn(memory).getState()).toMatchObject({
      promptDismissed: true,
      signedOut: true,
      pendingUpgradeAt: 1234,
    })
  })

  it('ignores stored data that does not fit, or an unknown version', () => {
    const memory = new MemoryStorage()
    memory.setItem(ACCOUNT_KEY, JSON.stringify({ state: { signedOut: 'yes' }, version: 1 }))
    expect(storeOn(memory).getState()).toMatchObject(INITIAL_ACCOUNT)
    memory.setItem(ACCOUNT_KEY, JSON.stringify({ state: { signedOut: true }, version: 0 }))
    expect(storeOn(memory).getState()).toMatchObject(INITIAL_ACCOUNT)
  })
})

describe('upgradePending', () => {
  it('holds while the link can still be opened, then runs out', () => {
    const max = accountJson.pendingUpgradeMaxAgeMs
    expect(upgradePending(null, 10)).toBe(false)
    expect(upgradePending(1000, 1000 + max)).toBe(true)
    expect(upgradePending(1000, 1001 + max)).toBe(false)
  })
})

describe('savePromptDue (CLAUDE.md principle 1, GR-4)', () => {
  const fresh = initialSave(engineConfig)
  const milestone = { ...fresh, goals: { ...fresh.goals, achieved: { 'first-paycheck': 600 } } }
  const due = (overrides: Partial<Parameters<typeof savePromptDue>[0]> = {}) =>
    savePromptDue({
      save: milestone,
      session: { status: 'anonymous' },
      dismissed: false,
      tourActive: false,
      pending: false,
      ...overrides,
    })

  it('shows only after the first milestone', () => {
    expect(due()).toBe(true)
    expect(due({ save: fresh })).toBe(false)
    expect(due({ save: { ...fresh, prestige: { ...fresh.prestige, count: 1 } } })).toBe(true)
  })

  it('never for a saved account, a player without a session, over the tour, once dismissed or mid-save', () => {
    expect(due({ session: { status: 'permanent' } })).toBe(false)
    for (const status of ['idle', 'local', 'connecting', 'refused'] as const) {
      expect(due({ session: { status } }), status).toBe(false)
    }
    expect(due({ tourActive: true })).toBe(false)
    expect(due({ dismissed: true })).toBe(false)
    expect(due({ pending: true })).toBe(false)
  })
})
