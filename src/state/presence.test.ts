import { beforeEach, describe, expect, it } from 'vitest'
import type { PresencePlayer } from '@/realtime/types'
import {
  applyPublicSnapshot,
  applySnapshot,
  presenceStore,
  presenceUnavailable,
  resetPresence,
  selectPlayer,
  setPlayerHidden,
  visiblePlayers,
} from './presence'

const player = (id: string, over: Partial<PresencePlayer> = {}): PresencePlayer => ({
  id,
  handle: `Handle${id}`,
  level: 'local',
  career: null,
  look: null,
  spot: 'place',
  place: 'late-lantern-deli',
  borough: 'queens',
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
      players: [player('a'), player('b', { spot: 'home', place: null }), player('c')],
    })
    const state = presenceStore.getState()
    expect(state.online).toBe(5)
    expect(state.players.map((p) => p.id)).toEqual(['a', 'c'])
    expect(state.elsewhere).toBe(1)
  })

  it('hides a blocked or muted player at once, and an Undo shows them again', () => {
    applySnapshot({ online: 3, players: [player('a'), player('b')] })
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
    applySnapshot({ online: 2, players: [player('a')] })
    selectPlayer('a')
    expect(presenceStore.getState().selected?.handle).toBe('Handlea')
    applySnapshot({ online: 1, players: [] })
    expect(presenceStore.getState().selected).toBeNull()
  })

  it('anonymous figures can never be selected', () => {
    applyPublicSnapshot({
      online: 7,
      figures: [{ place: 'late-lantern-deli', borough: 'queens', look: null }],
    })
    const [figure] = presenceStore.getState().players
    expect(figure?.handle).toBeNull()
    selectPlayer(figure?.id ?? '')
    expect(presenceStore.getState().selected).toBeNull()
    expect(presenceStore.getState().online).toBe(7)
  })

  it('hides the count and figures when reads keep failing', () => {
    applySnapshot({ online: 2, players: [player('a')] })
    presenceUnavailable()
    expect(presenceStore.getState()).toMatchObject({ online: null, players: [] })
  })
})
