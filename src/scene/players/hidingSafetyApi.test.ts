import { beforeEach, describe, expect, it } from 'vitest'
import { failure } from '@/lib/supabase/rpc'
import { unavailableSafetyApi, type SafetyApi } from '@/lib/supabase/safetyApi'
import {
  applySnapshot,
  presenceStore,
  resetPresence,
  selectPlayer,
  setPlayerHidden,
} from '@/state/presence'
import { hidingSafetyApi } from './PlayersOverlay'

const okApi: SafetyApi = {
  ...unavailableSafetyApi(),
  block: () =>
    Promise.resolve({
      ok: true,
      data: { undoId: 'u', undoExpiresAt: null, friendshipEnded: false, roommateEnded: false },
    }),
  unblock: () =>
    Promise.resolve({
      ok: true,
      data: { unblocked: true, friendshipRestored: false, roommateRestored: false },
    }),
  mute: () => Promise.resolve({ ok: true, data: null }),
  unmute: () => Promise.resolve({ ok: true, data: null }),
}

beforeEach(() => {
  resetPresence()
  setPlayerHidden('p1', false)
  applySnapshot({
    online: 2,
    ghost: false,
    players: [
      {
        id: 'p1',
        handle: 'Someone',
        level: 'local',
        career: null,
        look: null,
        worn: [],
        spot: 'place',
        place: 'late-lantern-deli',
        borough: 'queens',
        activity: null,
      },
    ],
  })
})

describe('hidingSafetyApi', () => {
  it('a block hides the player and closes their card; an Undo shows them again', async () => {
    const api = hidingSafetyApi(okApi)
    selectPlayer('p1')
    await api.block('p1')
    expect(presenceStore.getState().hidden.has('p1')).toBe(true)
    expect(presenceStore.getState().selected).toBeNull()
    await api.unblock('p1', 'u')
    expect(presenceStore.getState().hidden.has('p1')).toBe(false)
  })

  it('a mute hides; an unmute shows', async () => {
    const api = hidingSafetyApi(okApi)
    await api.mute('p1')
    expect(presenceStore.getState().hidden.has('p1')).toBe(true)
    await api.unmute('p1')
    expect(presenceStore.getState().hidden.has('p1')).toBe(false)
  })

  it('a refused block hides nobody', async () => {
    const api = hidingSafetyApi({ ...okApi, block: () => Promise.resolve(failure('rate_limited')) })
    await api.block('p1')
    expect(presenceStore.getState().hidden.has('p1')).toBe(false)
  })
})
