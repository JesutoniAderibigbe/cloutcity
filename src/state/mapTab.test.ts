import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSoundSheetOpen, soundSheetStore } from '@/components/audio/soundSheet'
import { dismissHudPanel, hudPanelStore, openHudPanel } from './hudPanel'
import { onMapRecenter } from './mapRecenter'
import { showMap } from './mapTab'
import { closePlace, currentPlaceId, openPlace } from './placeSheet'
import {
  autoOpenPlacesPanel,
  closePlacesPanel,
  openPlacesPanel,
  placesPanelStore,
} from './placesPanel'
import { tripStore, type ActiveTrip } from './trip'

const PLACE = 'some-place'

/** Counts recentre requests made while `run` runs. */
function recentres(run: () => void): number {
  const listener = vi.fn()
  const off = onMapRecenter(listener)
  try {
    run()
  } finally {
    off()
  }
  return listener.mock.calls.length
}

afterEach(() => {
  dismissHudPanel()
  closePlace()
  closePlacesPanel()
  setSoundSheetOpen(false)
  tripStore.setState({ active: null })
})

describe('the Map tab (showMap)', () => {
  it('closes a HUD panel (Home and its room) without recentring', () => {
    openHudPanel('home')
    expect(recentres(showMap)).toBe(0)
    expect(hudPanelStore.getState().panel).toBeNull()
  })

  it('closes a panel opened from the phone instead of going back to the phone', () => {
    openHudPanel('inventory', { fromPhone: true })
    showMap()
    expect(hudPanelStore.getState().panel).toBeNull()
  })

  it('closes an open place sheet', () => {
    openPlace(PLACE, { origin: 'map' })
    expect(recentres(showMap)).toBe(0)
    expect(currentPlaceId()).toBeNull()
  })

  it('closes the Places list the player opened', () => {
    openPlacesPanel()
    expect(recentres(showMap)).toBe(0)
    expect(placesPanelStore.getState().open).toBe(false)
  })

  it('closes the Settings sheet', () => {
    setSoundSheetOpen(true)
    expect(recentres(showMap)).toBe(0)
    expect(soundSheetStore.getState().open).toBe(false)
  })

  it('on the bare map, asks the camera to glide back to the player', () => {
    expect(recentres(showMap)).toBe(1)
  })

  it('keeps an automatically opened Places list: it stands in for a map that cannot draw', () => {
    autoOpenPlacesPanel()
    showMap()
    expect(placesPanelStore.getState().open).toBe(true)
  })

  it('leaves a trip under way to its follow camera', () => {
    tripStore.setState({ active: { id: 1 } as unknown as ActiveTrip })
    expect(recentres(showMap)).toBe(0)
  })
})
