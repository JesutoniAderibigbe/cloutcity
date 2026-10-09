/**
 * The dance moves (S16c): every body frame's rig has a lazy dance rig holding every move, and a
 * real player's move is picked from their id the same way on every client.
 */
import { describe, expect, it } from 'vitest'
import { danceMoves, pickBy } from './danceMoves'

describe('danceMoves', () => {
  it('finds a dance rig with every move for both body frames, and none for other rigs', () => {
    const moves = danceMoves()
    expect(moves.moves.length).toBeGreaterThanOrEqual(2)
    for (const frame of ['avatar-rig-f', 'avatar-rig-m']) {
      const rig = moves.rigFor(frame)
      expect(rig?.kind).toBe('rig')
      for (const move of moves.moves) expect(rig?.clips).toContain(move)
      // Lazy: never on the playable path.
      expect(rig?.files.high).toMatch(/^\/models\/avatar-dance-/)
    }
    expect(moves.rigFor('npc-man')).toBeNull()
  })

  it('picks a stable move in range from an id, spreading ids over the moves', () => {
    expect(pickBy('player-1', 3)).toBe(pickBy('player-1', 3))
    const picks = new Set<number>()
    for (let i = 0; i < 30; i++) {
      const pick = pickBy(`player-${i}`, 3)
      expect(pick).toBeGreaterThanOrEqual(0)
      expect(pick).toBeLessThan(3)
      picks.add(pick)
    }
    expect(picks.size).toBe(3)
    expect(pickBy('anyone', 0)).toBe(0)
  })
})
