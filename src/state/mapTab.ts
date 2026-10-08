/**
 * What the Map tab does, like Lagos Life's: it always brings the city map to the front. Any HUD
 * panel (and the room with Home), place sheet, Places list or Settings sheet closes; tapped when
 * none is open, the camera glides back to the player at the default view.
 *
 * Kept up: an automatically opened Places list (it stands in for a 3D map that cannot draw), and
 * a trip's progress card, whose follow camera already shows the player on the map.
 */
import { setSoundSheetOpen, soundSheetStore } from '@/components/audio/soundSheet'
import { dismissHudPanel, hudPanelStore } from './hudPanel'
import { requestMapRecenter } from './mapRecenter'
import { closePlace, currentPlaceId } from './placeSheet'
import { closePlacesPanel, placesPanelStore } from './placesPanel'
import { tripStore } from './trip'

export function showMap(): void {
  const places = placesPanelStore.getState()
  const listUp = places.open && !places.auto
  const settingsUp = soundSheetStore.getState().open
  const covered =
    hudPanelStore.getState().panel !== null || currentPlaceId() !== null || listUp || settingsUp
  dismissHudPanel()
  closePlace()
  if (listUp) closePlacesPanel()
  if (settingsUp) setSoundSheetOpen(false)
  if (!covered && tripStore.getState().active === null) requestMapRecenter()
}
