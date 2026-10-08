/**
 * The HUD's goal line for the player's Dream (S16a): the career path's goal from the career copy
 * namespace, or the plain goal before a path is chosen. Kept apart from src/lib/creatorCopy.ts
 * (which pulls in the creator's config) so the HUD's boot island gains only this map and the
 * career strings. src/lib/careerGoal.test.ts holds it to `career.<camelId>.goal`.
 */
import type { CareerPathId } from '@/lib/data/avatarIds'
import type { CopyKey } from './copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/career'

export const CAREER_GOAL_KEY: Readonly<Record<CareerPathId, CopyKey>> = {
  influencer: 'career.influencer.goal',
  streamer: 'career.streamer.goal',
  'artist-dj': 'career.artistDj.goal',
  'founder-hustler': 'career.founderHustler.goal',
}

/** The goal line's copy key for `careerPath` (null: no Dream chosen yet). */
export function goalLineKey(careerPath: CareerPathId | null): CopyKey {
  return careerPath === null ? 'hud.goalLine' : CAREER_GOAL_KEY[careerPath]
}
