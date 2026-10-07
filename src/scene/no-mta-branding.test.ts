/**
 * S04a: subway lines are drawn in our own palette with plain letters, never MTA trade dress
 * (the trunk-line colours and the white-letter circle "bullets"). Scans the theme, the scene
 * config and the geo data the scene reads, so a later palette or data change cannot bring an
 * MTA colour back in.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

/** MTA trunk-line colours (published MTA brand standards), lower case, no '#'. */
const MTA_TRUNK_HEXES = [
  'ee352e', // 1 2 3
  '00933c', // 4 5 6
  'b933ad', // 7
  '0039a6', // A C E
  'ff6319', // B D F M
  '6cbe45', // G
  '996633', // J Z
  'a7a9ac', // L
  'fccc0a', // N Q R W
  '808183', // S
  '00add0', // SIR
]

const SCANNED = [
  'data/config/theme.json',
  'data/config/scene.json',
  'data/geo/subway.derived.json',
  'src/app/globals.css',
]

interface Theme {
  colors: Record<string, string>
  scene: { subwayLines: string[]; labelInk: string; station: string }
}
const theme = JSON.parse(read('data/config/theme.json')) as Theme
const scene = JSON.parse(read('data/config/scene.json')) as {
  labels: { cornerRadius: number }
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

describe('no MTA branding in the scene (S04a)', () => {
  for (const file of SCANNED) {
    it(`${file} contains no MTA trunk-line colour`, () => {
      const text = read(file).toLowerCase()
      const found = MTA_TRUNK_HEXES.filter((hex) => new RegExp(`#?${hex}\\b`).test(text))
      expect(found).toEqual([])
    })
  }

  it('every subway line colour is one of our palette tokens, not an MTA colour', () => {
    expect(theme.scene.subwayLines.length).toBeGreaterThan(0)
    for (const token of theme.scene.subwayLines) {
      const hex = theme.colors[token]
      expect(hex, `token ${token}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(MTA_TRUNK_HEXES).not.toContain(hex?.slice(1).toLowerCase())
    }
  })

  it('line chips are rounded squares with dark letters, not white-letter circles', () => {
    // A corner radius of half the chip would make a circle (the MTA bullet shape).
    expect(scene.labels.cornerRadius).toBeLessThan(0.5)
    const ink = theme.colors[theme.scene.labelInk]
    expect(ink, `labelInk token ${theme.scene.labelInk}`).toBeDefined()
    // Dark ink: far from the MTA's white lettering.
    expect(luminance(ink ?? '#ffffff')).toBeLessThan(0.2)
  })
})
