import { beforeEach, describe, expect, it } from 'vitest'
import type { PresencePlayer } from '@/realtime/types'
import {
  applyPublicSnapshot,
  applySnapshot,
  presenceStore,
  presenceUnavailable,
  resetPresence,
  selectPlayer,
  setGhostKnown,
  setPlayerHidden,
  visiblePlayers,
} from './presence'

const player = (id: string, over: Partial<PresencePlayer> = {}): PresencePlayer => ({
  id,
  handle: `Handle${id}`,
  level: 'local',
  career: null,
  look: null,
  worn: [],
  spot: 'place',
  place: 'late-lantern-deli',
  borough: 'queens',
  activity: null,
  ...over,
})

beforeEach(() => {
  resetPresence()
  for (const id of presenceStore.getState().hidden) setPlayerHidden(id, false)
})

describe('presence store', () => {
  it('draws players at places and counts the rest', () => {
    applySnapshot({
      online: 5,
      ghost: false,
      players: [player('a'), player('b', { spot: 'home', place: null }), player('c')],
    })
    const state = presenceStore.getState()
    expect(state.online).toBe(5)
    expect(state.players.map((p) => p.id)).toEqual(['a', 'c'])
    expect(state.elsewhere).toBe(1)
  })

  it('hides a blocked or muted player at once, and an Undo shows them again', () => {
    applySnapshot({ online: 3, ghost: false, players: [player('a'), player('b')] })
    selectPlayer('a')
    setPlayerHidden('a', true)
    expect(visiblePlayers().map((p) => p.id)).toEqual(['b'])
    selectPlayer('a')
    expect(presenceStore.getState().selected?.id).toBe('a')
    selectPlayer(null)
    selectPlayer('a')
    expect(presenceStore.getState().selected).toBeNull()
    setPlayerHidden('a', false)
    expect(visiblePlayers().map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('closes the card of a player who left or is now hidden by the server', () => {
    applySnapshot({ online: 2, ghost: false, players: [player('a')] })
    selectPlayer('a')
    expect(presenceStore.getState().selected?.handle).toBe('Handlea')
    applySnapshot({ online: 1, ghost: false, players: [] })
    expect(presenceStore.getState().selected).toBeNull()
  })

  it('a signed-out read is the count only: nobody drawn, no card left open', () => {
    applySnapshot({ online: 2, ghost: false, players: [player('a')] })
    selectPlayer('a')
    applyPublicSnapshot({ online: 7 })
    expect(presenceStore.getState()).toMatchObject({ online: 7, players: [], selected: null })
  })

  it('hides the count and players when reads keep failing', () => {
    applySnapshot({ online: 2, ghost: false, players: [player('a')] })
    presenceUnavailable()
    expect(presenceStore.getState()).toMatchObject({ online: null, players: [] })
  })

  it("keeps the activity, worn items and the viewer's own ghost mode from a read", () => {
    applySnapshot({
      online: 1,
      ghost: true,
      players: [player('a', { activity: 'dance', worn: ['denim-jacket'] })],
    })
    const state = presenceStore.getState()
    expect(state.ghost).toBe(true)
    expect(state.players[0]).toMatchObject({ activity: 'dance', worn: ['denim-jacket'] })
    setGhostKnown(false)
    expect(presenceStore.getState().ghost).toBe(false)
    applyPublicSnapshot({ online: 1 })
    expect(presenceStore.getState().ghost).toBeNull()
  })
})
