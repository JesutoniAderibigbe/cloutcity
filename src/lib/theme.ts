import type { CSSProperties } from 'react'
import { theme } from '@/lib/data/config'
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

/** Hex of one palette token; theme.json's schema guarantees every scene reference exists. */
function tokenHex(token: string): string {
  const hex = theme.colors[token]
  if (hex === undefined) throw new Error(`theme.json: unknown palette token "${token}"`)
  return hex
}

/**
 * The 3D city's colours resolved from palette tokens to hex on the server, so the scene chunk
 * needs neither the config loader nor any colour literal.
 */
export function scenePalette(): ScenePalette {
  const { scene } = theme
  return {
    background: tokenHex(scene.background),
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
    ambientLight: tokenHex(scene.ambientLight),
    sunLight: tokenHex(scene.sunLight),
    pins: {
      venue: tokenHex(scene.pins.venue),
      landmark: tokenHex(scene.pins.landmark),
      teaser: tokenHex(scene.pins.teaser),
      muted: tokenHex(scene.pins.muted),
      selected: tokenHex(scene.pins.selected),
    },
    chip: { fill: tokenHex(scene.chip.fill), ink: tokenHex(scene.chip.ink) },
    toonRamp: [...scene.toonRamp],
  }
}
