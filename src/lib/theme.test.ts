import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { theme } from '@/lib/data/config'
import { paletteStyle, paletteVar, themeColorHex } from './theme'

const SRC = join(import.meta.dirname, '..')
const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8')

describe('theme tokens', () => {
  it('globals.css maps exactly the theme.json tokens to Tailwind colours', () => {
    const mapped = Array.from(
      css.matchAll(/--color-([a-z]+-\d+):\s*var\(--palette-([a-z]+-\d+)\)/g),
    )
    expect(mapped.every(([, color, palette]) => color === palette)).toBe(true)
    expect(mapped.map(([, token]) => token).sort()).toEqual(Object.keys(theme.colors).sort())
  })

  it('writes every token as a palette variable for the root element', () => {
    const style = paletteStyle() as Record<string, string>
    for (const [token, hex] of Object.entries(theme.colors)) {
      expect(style[paletteVar(token)]).toBe(hex)
    }
    expect(themeColorHex()).toBe(theme.colors[theme.themeColor])
  })

  it('no stylesheet or component under src/ hardcodes a colour', () => {
    const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(css|tsx?)$/.test(entry.name))
      .filter((entry) => !entry.name.endsWith('.test.ts'))
      .map((entry) => join(entry.parentPath, entry.name))
    const offenders = files.filter((file) =>
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
