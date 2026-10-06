import type { CSSProperties } from 'react'
import { theme } from '@/lib/data/config'

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
