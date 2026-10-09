import { describe, expect, it, vi } from 'vitest'
import type { PublicAvatar } from '@/engine/appearance'
import {
  interiorOccupants,
  onOccupantPicked,
  pickOccupant,
  setInteriorOccupants,
  type InteriorOccupant,
} from './venueOccupants'

const occupant = (id: string): InteriorOccupant => ({
  id,
  handle: `handle-${id}`,
  avatar: {} as PublicAvatar,
  activity: 'dance',
})

describe('venue occupants (S43 hook)', () => {
  it('has nobody inside until presence says so, per venue', () => {
    expect(interiorOccupants('glowmatic')).toEqual([])
    setInteriorOccupants('glowmatic', [occupant('a'), occupant('b')])
    expect(interiorOccupants('glowmatic').map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(interiorOccupants('golden-hour-roof')).toEqual([])
    setInteriorOccupants('glowmatic', [])
    expect(interiorOccupants('glowmatic')).toEqual([])
  })

  it('reports a tap on a name tag until the listener stops', () => {
    const listener = vi.fn()
    const stop = onOccupantPicked(listener)
    pickOccupant('glowmatic', 'a')
    stop()
    pickOccupant('glowmatic', 'b')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('glowmatic', 'a')
  })
})
