/**
 * What a player at a venue can announce they are doing there (S42c): an enum on the wire, never
 * free text. The venue interior stands them at a spot for it (src/state/venueOccupants.ts
 * `InteriorActivity` is this list); the server checks the same ids (presence_beat).
 */
export const PRESENCE_ACTIVITY_IDS = ['dance', 'bar', 'booth', 'chat', 'lounge', 'idle'] as const
export type PresenceActivity = (typeof PRESENCE_ACTIVITY_IDS)[number]
