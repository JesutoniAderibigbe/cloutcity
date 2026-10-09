import { describe, expect, it } from 'vitest'
import { placePlayers } from './playerPlacement'

const config = { ringStartOfHeight: 1, ringStepOfHeight: 0.5, perRing: 4 }
const pins = new Map([
  ['deli', { x: 100, y: 200 }],
  ['park', { x: -50, y: 0 }],
])

describe('placePlayers', () => {
  it('stands players around their pin at the first ring, facing it', () => {
    const placed = placePlayers([{ id: 'a', place: 'deli' }], pins, 2, config)
    expect(placed).toHaveLength(1)
    const [p] = placed
    expect(Math.hypot((p?.x ?? 0) - 100, (p?.y ?? 0) - 200)).toBeCloseTo(2)
    // Facing the pin: the yaw's direction (sin, -cos) points from the player to the pin.
    const yaw = p?.yaw ?? 0
    const towards = { x: 100 - (p?.x ?? 0), y: 200 - (p?.y ?? 0) }
    const length = Math.hypot(towards.x, towards.y)
    expect(Math.sin(yaw)).toBeCloseTo(towards.x / length)
    expect(-Math.cos(yaw)).toBeCloseTo(towards.y / length)
  })

  it('fills rings of perRing, the next ring further out', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, place: 'deli' }))
    const radii = placePlayers(players, pins, 2, config).map((p) =>
      Math.round(Math.hypot(p.x - 100, p.y - 200) * 100),
    )
    expect(radii.filter((r) => r === 200)).toHaveLength(4)
    expect(radii.filter((r) => r === 300)).toHaveLength(2)
  })

  it('never puts two players on one spot', () => {
    const players = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, place: 'deli' }))
    const spots = new Set(
      placePlayers(players, pins, 2, config).map(
        (p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`,
      ),
    )
    expect(spots.size).toBe(20)
  })

  it('is stable whatever order the server answers in', () => {
    const players = [
      { id: 'b', place: 'deli' },
      { id: 'a', place: 'deli' },
      { id: 'c', place: 'park' },
    ]
    const one = placePlayers(players, pins, 2, config)
    const two = placePlayers([...players].reverse(), pins, 2, config)
    const key = (list: typeof one) =>
      list.map((p) => `${p.id}:${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`).sort()
    expect(key(two)).toEqual(key(one))
  })

  it('leaves out players at places with no pin', () => {
    expect(placePlayers([{ id: 'a', place: 'nowhere' }], pins, 2, config)).toEqual([])
  })
})
