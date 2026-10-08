import { afterEach, describe, expect, it } from 'vitest'
import type { ApartmentView } from '@/scene/apartment/types'
import {
  apartmentViewStore,
  onApartmentCellTap,
  setApartmentView,
  tapApartmentCell,
} from './apartmentView'

afterEach(() => setApartmentView(null))

const view: ApartmentView = {
  home: 'queens-room',
  placed: {},
  finishes: { wall: 'butter-cream', floor: 'bodega-checker' },
  cells: null,
  label: 'Your apartment, Queens room',
  minute: 0,
  tier: 'mid',
}

describe('apartment view', () => {
  it('holds the Home panel view until the panel clears it', () => {
    expect(apartmentViewStore.getState().view).toBeNull()
    setApartmentView(view)
    expect(apartmentViewStore.getState().view).toBe(view)
    setApartmentView(null)
    expect(apartmentViewStore.getState().view).toBeNull()
  })

  it('delivers room taps to listeners until they stop', () => {
    const taps: string[] = []
    const stop = onApartmentCellTap((slotId) => taps.push(slotId))
    tapApartmentCell('f3-1')
    stop()
    tapApartmentCell('w-back-0')
    expect(taps).toEqual(['f3-1'])
  })
})
