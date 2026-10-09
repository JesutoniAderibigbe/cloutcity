'use client'

/**
 * A venue's inside view behind its place sheet (S43), like the apartment behind the Home panel:
 * when the player is at a venue whose type has an interior (data/interiors/types.json), the
 * interior draws in the scene's room slot (`[data-scene-slot="room"]`, src/scene/CityScene.tsx),
 * under every overlay zone, and once it is up the city hands it the screen. The sheet
 * keeps working as it is; each action it runs, the player's Sim acts out inside. Closing the sheet
 * (or the interior's exit button) leaves for the map.
 *
 * The canvas is its own chunk (`cc-feature:venue-interior`, React.lazy: this module rides in the
 * place sheet's chunk, never the shell), left out of the precache. Without WebGL2, while the
 * chunk loads, if it fails to load (offline before it was cached) or to start, nothing shows and
 * the sheet over the map works as before (A11Y-3: every action stays in the sheet).
 */
import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import typesJson from '@data/interiors/types.json'
import type { Venue } from '@/lib/data/schemas/content'
import { copy } from '@/lib/copy'
import { log } from '@/lib/log'
import { useApartmentView } from '@/state/apartmentView'
import { closePlace } from '@/state/placeSheet'
import { useActiveTier } from '@/state/quality'
import { webgl2Available } from '@/scene/webgl'
// Copy namespaces this module renders (DEC-11: they load with the place sheet's chunk).
import '@/lib/copy/ns/place'

const VenueCanvas = lazy(() => import('@/scene/venue/VenueCanvas'))

/** Logged once when an interior fails to load or start; the sheet still works over the map. */
export const INTERIOR_FAILED_MESSAGE = 'Venue interior failed to start; the place sheet still works'

const ROOM_SLOT_SELECTOR = '[data-scene-slot="room"]'

const byVenueType: Readonly<Record<string, string | undefined>> = typesJson.byVenueType
const byVenue: Readonly<Record<string, string | undefined>> = typesJson.byVenue

/**
 * The interior a venue opens, or null (data/interiors/types.json): its own when it has one (the
 * boxing gym, the warehouse), else its type's.
 */
export function interiorFor(venue: Pick<Venue, 'id' | 'type'>): string | null {
  return byVenue[venue.id] ?? byVenueType[venue.type] ?? null
}

class InteriorBoundary extends Component<
  { readonly children: ReactNode; readonly onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error): void {
    // The logger keeps only the error's name: messages can echo payload text.
    log.warn(INTERIOR_FAILED_MESSAGE, { reason: 'render', error })
    this.props.onError()
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

let webglProbe: boolean | undefined

function canDraw(): boolean {
  webglProbe ??= webgl2Available()
  return webglProbe
}

export function VenueInterior({
  place,
  here,
  open,
  minute,
  name,
}: {
  readonly place: Venue
  /** The player is at this venue (only then is there an inside to show). */
  readonly here: boolean
  /** Open now on the personal clock (the engine's hours). */
  readonly open: boolean
  readonly minute: number
  readonly name: string
}) {
  const interiorId = interiorFor(place)
  // The Home panel's room has the slot while it shows.
  const roomShown = useApartmentView() !== null
  const tier = useActiveTier() ?? 'mid'
  const [failed, setFailed] = useState(false)
  const wanted = interiorId !== null && here && !roomShown && !failed
  // The sheet renders only in the browser, after hydration (a lazy island), where the scene's
  // slot already stands.
  const slot = wanted ? document.querySelector<HTMLElement>(ROOM_SLOT_SELECTOR) : null
  const showing = wanted && slot !== null && canDraw()

  if (!showing || interiorId === null) return null
  return createPortal(
    <InteriorBoundary onError={() => setFailed(true)}>
      <Suspense fallback={null}>
        <VenueCanvas
          placeId={place.id}
          interiorId={interiorId}
          label={copy('place.interior.label', { place: name })}
          resetLabel={copy('place.interior.reset')}
          exitText={copy('place.interior.exit')}
          exitLabel={copy('place.interior.exitLabel', { place: name })}
          minute={minute}
          open={open}
          tier={tier}
          onExit={closePlace}
        />
      </Suspense>
    </InteriorBoundary>,
    slot,
  )
}
