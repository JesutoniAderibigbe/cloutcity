/** data/config/scene.json and the scene block of theme.json. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scenePalette } from '@/lib/theme'
import { scene, theme } from './config'
import { geoBounds } from './content'
import { BOROUGHS } from './schemas/content'
import { ThemeConfigSchema } from './schemas/config'
import { SceneConfigSchema } from './schemas/scene'

const DATA = join(import.meta.dirname, '../../../data')
const readJson = (file: string) =>
  JSON.parse(readFileSync(join(DATA, file), 'utf8')) as Record<string, unknown>

describe('config/scene.json', () => {
  it('starts the camera at Court Square, inside the NYC extent', () => {
    const { lat, lng } = scene.camera.start
    expect(lat).toBeGreaterThan(geoBounds.south)
    expect(lat).toBeLessThan(geoBounds.north)
    expect(lng).toBeGreaterThan(geoBounds.west)
    expect(lng).toBeLessThan(geoBounds.east)
  })

  it('rejects a start distance outside the zoom limits, an inverted angle range or a flat sun', () => {
    const valid = readJson('config/scene.json') as {
      camera: Record<string, unknown>
      lights: Record<string, unknown>
    }
    expect(SceneConfigSchema.safeParse(valid).success).toBe(true)
    const withCamera = (camera: Record<string, unknown>) => ({
      ...valid,
      camera: { ...valid.camera, ...camera },
    })
    expect(SceneConfigSchema.safeParse(withCamera({ distanceM: 1 })).success).toBe(false)
    expect(
      SceneConfigSchema.safeParse(withCamera({ polarDeg: { default: 48, min: 60, max: 12 } }))
        .success,
    ).toBe(false)
    expect(
      SceneConfigSchema.safeParse(withCamera({ polarDeg: { default: 48, min: 12, max: 95 } }))
        .success,
    ).toBe(false)
    const flatSun = { ...valid, lights: { ...valid.lights, sunDirection: { x: 1, y: 0, z: 0 } } }
    expect(SceneConfigSchema.safeParse(flatSun).success).toBe(false)
  })
})

describe('theme.json scene palette', () => {
  it('has a land colour for every borough', () => {
    expect(Object.keys(theme.scene.land).sort()).toEqual([...BOROUGHS].sort())
  })

  it('rejects a scene colour that names no token and a ramp that does not increase', () => {
    const valid = readJson('config/theme.json') as { scene: Record<string, unknown> }
    expect(ThemeConfigSchema.safeParse(valid).success).toBe(true)
    const withScene = (patch: Record<string, unknown>) => ({
      ...valid,
      scene: { ...valid.scene, ...patch },
    })
    expect(ThemeConfigSchema.safeParse(withScene({ water: 'nope-500' })).success).toBe(false)
    expect(ThemeConfigSchema.safeParse(withScene({ subwayLines: [] })).success).toBe(false)
    expect(ThemeConfigSchema.safeParse(withScene({ toonRamp: [0.6, 0.3] })).success).toBe(false)
  })

  it('resolves every scene token to its hex on the server', () => {
    const palette = scenePalette()
    expect(palette.water).toBe(theme.colors[theme.scene.water])
    expect(palette.land.queens).toBe(theme.colors[theme.scene.land.queens])
    expect(palette.subwayLines).toEqual(theme.scene.subwayLines.map((t) => theme.colors[t]))
    expect(palette.toonRamp).toEqual(theme.scene.toonRamp)
  })
})
