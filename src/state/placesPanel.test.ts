import { afterEach, describe, expect, it } from 'vitest'
import { closePlace, openPlace, placeSheetStore } from './placeSheet'
import {
  autoOpenPlacesPanel,
  closeAutoPlacesPanel,
  closePlacesPanel,
  keepPlacesPanel,
  openPlacesChooser,
  openPlacesPanel,
  placesPanelStore,
} from './placesPanel'

afterEach(() => {
  closePlacesPanel()
  closePlace()
})

describe('places panel store (S04c)', () => {
  it('starts closed and opens the full list, replacing an open place sheet', () => {
    expect(placesPanelStore.getState()).toMatchObject({ open: false, mode: 'list', auto: false })
    openPlace('glowmatic', { origin: 'map' })
    openPlacesPanel()
    expect(placesPanelStore.getState()).toEqual({
      open: true,
      mode: 'list',
      chooserIds: [],
      auto: false,
    })
    expect(placeSheetStore.getState().placeId).toBeNull()
  })

  it('opens a chooser with the given places, nearest first, and copies the list', () => {
    const ids = ['a', 'b']
    openPlacesChooser(ids)
    ids.push('c')
    expect(placesPanelStore.getState()).toMatchObject({
      open: true,
      mode: 'chooser',
      chooserIds: ['a', 'b'],
      auto: false,
    })
  })

  it('auto-opens without replacing a panel the player opened, and keeps a place sheet', () => {
    openPlace('glowmatic', { origin: 'map' })
    autoOpenPlacesPanel()
    expect(placesPanelStore.getState()).toMatchObject({ open: true, auto: true })
    expect(placeSheetStore.getState().placeId).toBe('glowmatic')

    closePlacesPanel()
    openPlacesChooser(['x'])
    autoOpenPlacesPanel()
    expect(placesPanelStore.getState()).toMatchObject({ mode: 'chooser', auto: false })
  })

  it('closes an auto-opened panel when the map is back, unless the player has used it', () => {
    autoOpenPlacesPanel()
    closeAutoPlacesPanel()
    expect(placesPanelStore.getState().open).toBe(false)

    autoOpenPlacesPanel()
    keepPlacesPanel()
    closeAutoPlacesPanel()
    expect(placesPanelStore.getState()).toMatchObject({ open: true, auto: false })

    // A panel the player opened is never closed for them.
    openPlacesPanel()
    closeAutoPlacesPanel()
    expect(placesPanelStore.getState().open).toBe(true)
  })
})
