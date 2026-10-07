import { describe, expect, it } from 'vitest'
import { geoManifest, geoVersion } from '@/lib/data/geo'
import { parseGeoBase } from '@/scene/geo/schema'
import { GET, dynamic } from './route'

describe('GET /geo/base', () => {
  it('is prerendered at build time', () => {
    expect(dynamic).toBe('force-static')
  })

  it('serves every base layer in the format the scene validates, tagged with geoVersion', async () => {
    const response = GET()
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    const body = parseGeoBase(await response.json())
    expect(body.version).toBe(geoVersion)
    expect(body.land.boroughs.length).toBeGreaterThan(0)
    expect(body.subway.stations.length).toBeGreaterThan(0)
  })
})

describe('geoVersion', () => {
  it('is a 12-hex hash that changes when a base file hash changes', async () => {
    expect(geoVersion).toMatch(/^[0-9a-f]{12}$/)
    const { createHash } = await import('node:crypto')
    const hashOf = (files: typeof geoManifest.files) =>
      createHash('sha256')
        .update(
          files
            .filter((file) => file.group === 'base')
            .map((file) => `${file.path}:${file.sha256}`)
            .join('\n'),
        )
        .digest('hex')
        .slice(0, 12)
    expect(hashOf(geoManifest.files)).toBe(geoVersion)
    const changed = geoManifest.files.map((file, i) =>
      i === 1 ? { ...file, sha256: '0'.repeat(64) } : file,
    )
    expect(hashOf(changed)).not.toBe(geoVersion)
  })
})
