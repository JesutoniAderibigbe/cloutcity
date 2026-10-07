import type { CSSProperties } from 'react'
import { scene, theme } from '@/lib/data/config'
import {
  resolveDayNight,
  resolveSkyColors,
  type DayNightModel,
  type SkyColors,
  type ThemeDayNight,
} from '@/lib/dayNight'
import type { ScenePalette } from '@/scene/types'

/** CSS custom property that carries one palette token (consumed by globals.css). */
export function paletteVar(token: string): `--palette-${string}` {
  return `--palette-${token}`
}

/** Every palette token as a CSS variable, for the root element's style. */
export function paletteStyle(): CSSProperties {
  return Object.fromEntries(
    Object.entries(theme.colors).map(([token, hex]) => [paletteVar(token), hex]),
  ) as CSSProperties
}

/** Hex of the browser/PWA theme colour token. */
export function themeColorHex(): string {
  const hex = theme.colors[theme.themeColor]
  if (hex === undefined) throw new Error(`theme.json: unknown themeColor "${theme.themeColor}"`)
  return hex
}

/** The world palette: 3D-only colours plus the models' real-material colours (DEC-26). */
const worldColors: Readonly<Record<string, string>> = { ...theme.world, ...theme.models }

/** Hex of one world token; theme.json's schema guarantees every scene reference exists. */
function tokenHex(token: string): string {
  const hex = worldColors[token]
  if (hex === undefined) throw new Error(`theme.json: unknown world token "${token}"`)
  return hex
}

const themeDayNight: ThemeDayNight = { colors: worldColors, sky: theme.sky }

/**
 * Each day/night keyframe's colours (S04f), resolved to hex on the server: the 3D chunk joins
 * them with the keyframes of the scene config it already gets, so neither the theme nor the
 * keyframes travel twice.
 */
export function skyColors(): SkyColors {
  return resolveSkyColors(themeDayNight)
}

/** The day/night model the city lights by (scene.json keyframes, theme.json sky colours). */
export function dayNightModel(): DayNightModel {
  return resolveDayNight(scene.dayNight, themeDayNight)
}

/**
 * The 3D city's colours resolved from palette tokens to hex on the server, so the scene chunk
 * needs neither the config loader nor any colour literal.
 */
export function scenePalette(): ScenePalette {
  const { scene } = theme
  return {
    haze: tokenHex(scene.haze),
    water: tokenHex(scene.water),
    land: {
      manhattan: tokenHex(scene.land.manhattan),
      brooklyn: tokenHex(scene.land.brooklyn),
      queens: tokenHex(scene.land.queens),
      bronx: tokenHex(scene.land.bronx),
      'staten-island': tokenHex(scene.land['staten-island']),
    },
    park: tokenHex(scene.park),
    cemetery: tokenHex(scene.cemetery),
    subwayLines: scene.subwayLines.map(tokenHex),
    subwayCasing: tokenHex(scene.subwayCasing),
    station: tokenHex(scene.station),
    player: tokenHex(scene.player),
    labelInk: tokenHex(scene.labelInk),
    pins: {
      venue: tokenHex(scene.pins.venue),
      landmark: tokenHex(scene.pins.landmark),
      teaser: tokenHex(scene.pins.teaser),
      muted: tokenHex(scene.pins.muted),
      selected: tokenHex(scene.pins.selected),
    },
    chip: { fill: tokenHex(scene.chip.fill), ink: tokenHex(scene.chip.ink) },
    travel: {
      taxi: tokenHex(scene.travel.taxi),
      train: tokenHex(scene.travel.train),
      trail: tokenHex(scene.travel.trail),
    },
    toonRamp: [...scene.toonRamp],
    buildings: {
      wall: tokenHex(scene.buildings.wall),
      roof: tokenHex(scene.buildings.roof),
      window: tokenHex(scene.buildings.window),
      block: tokenHex(scene.buildings.block),
    },
    landmarks: Object.fromEntries(
      Object.entries(scene.landmarks).map(([role, token]) => [role, tokenHex(token)]),
    ) as ScenePalette['landmarks'],
  }
}
