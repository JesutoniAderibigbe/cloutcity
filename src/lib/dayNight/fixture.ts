/**
 * The default day/night model, in the shapes scene.json `dayNight` and theme.json `sky` take.
 * PLACEHOLDER values (fixture.json): S04f part 1 moves them into those files and tunes them in
 * the showcase; until then the scene and tests read them from here. Colour tokens are named
 * `<keyframe>-<slot>`.
 */
import fixtureJson from './fixture.json'
import { resolveDayNight } from './resolveDayNight'
import type {
  DayNightModel,
  KeyframeColors,
  KeyframeId,
  SceneDayNight,
  ThemeDayNight,
} from './types'

/** JSON widens the id and ui literals; resolveDayNight checks both at load. */
export const DEFAULT_SCENE_DAY_NIGHT = fixtureJson.scene as SceneDayNight

function themeFixture(): ThemeDayNight {
  const colors: Record<string, string> = {}
  const sky = {} as Record<KeyframeId, KeyframeColors<string>>
  for (const [id, slots] of Object.entries(fixtureJson.sky)) {
    const tokens: Record<string, string> = {}
    for (const [slot, hex] of Object.entries(slots)) {
      const token = `${id}-${slot}`
      colors[token] = hex
      tokens[slot] = token
    }
    sky[id as KeyframeId] = tokens as unknown as KeyframeColors<string>
  }
  return { colors, sky }
}

export const DEFAULT_THEME_DAY_NIGHT: ThemeDayNight = themeFixture()

export const DEFAULT_DAY_NIGHT_MODEL: DayNightModel = resolveDayNight(
  DEFAULT_SCENE_DAY_NIGHT,
  DEFAULT_THEME_DAY_NIGHT,
)
