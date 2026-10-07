import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { placesLayer } from '@/lib/world/placesLayer'
import { mixHex } from '@/lib/world/fallbackMap'
import { GET, dynamic } from './route'

/** S04c plan: the static fallback map stays small enough to load on a bad connection. */
const MAX_GZ_BYTES = 20_000

async function svg(): Promise<string> {
  return GET().text()
}

describe('GET /geo/fallback', () => {
  it('is prerendered at build time and served as SVG', () => {
    expect(dynamic).toBe('force-static')
    expect(GET().headers.get('content-type')).toMatch(/^image\/svg\+xml/)
  })

  it(`is at most ${MAX_GZ_BYTES / 1000} KB gzipped`, async () => {
    const bytes = gzipSync(Buffer.from(await svg()), { level: 9 }).byteLength
    expect(bytes).toBeLessThanOrEqual(MAX_GZ_BYTES)
  })

  it('draws the five boroughs, the parks, one dot per place and the borough names', async () => {
    const text = await svg()
    expect(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(text.match(/<circle /g)).toHaveLength(placesLayer.pins.length)
    for (const name of ['Queens', 'Brooklyn', 'Manhattan', 'The Bronx', 'Staten Island']) {
      expect(text).toContain(`>${name}</tspan>`)
    }
    // Five land paths plus the park and cemetery paths.
    expect((text.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('labels the dimmed boroughs "expanding soon", dimmer than the rest', async () => {
    const text = await svg()
    expect(text.match(/>Expanding soon<\/tspan>/g)).toHaveLength(
      placesLayer.boroughs.filter((b) => b.render === 'dimmed').length,
    )
  })

  it('is deterministic', async () => {
    expect(await svg()).toBe(await svg())
  })
})

describe('mixHex', () => {
  it('mixes channel by channel', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#102030', '#305070', 0.5)).toBe('#203850')
  })
})
