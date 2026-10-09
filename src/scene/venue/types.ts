/**
 * What a venue interior's 3D chunk (S43) is given, as types only: the place sheet decides it
 * (src/components/places/VenueInterior.tsx) without importing three.
 */
import type { QualityTier } from '@/lib/data/schemas/config'

export interface VenueView {
  /** The venue (data/venues/venues.json id): seeds its crowd, keys its occupants. */
  readonly placeId: string
  /** The interior it opens (data/interiors/types.json). */
  readonly interiorId: string
  /** The canvas's accessible name ("Inside Glowmatic"). */
  readonly label: string
  /** The reset-view button's name. */
  readonly resetLabel: string
  /** The exit button's text and accessible name. */
  readonly exitText: string
  readonly exitLabel: string
  /** The personal-clock minute: lighting, crowd and busy nights follow it. */
  readonly minute: number
  /** Whether the venue is open now (the engine's hours): the music, lights and crowd run. */
  readonly open: boolean
  readonly tier: QualityTier
}

export interface VenueViewProps extends VenueView {
  /** Leaves the interior for the map (closes the place sheet). */
  readonly onExit: () => void
}

/** Name of the player's Sim group in an interior (the test hook finds it by name). */
export const VENUE_AVATAR_NAME = 'venue-avatar'
