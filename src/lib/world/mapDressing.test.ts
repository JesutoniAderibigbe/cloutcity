import { describe, expect, it } from 'vitest'
import { homes } from '@/lib/data/content'
import { project } from '@/lib/geo/projection'
import { areaNames, homePoints, worldHex } from './mapDressing'

describe('map dressing (S04m)', () => {
  it('resolves world and model tokens and rejects unknown ones', () => {
    expect(worldHex('lawn-400')).toMatch(/^#[0-9a-f]{6}$/)
    expect(worldHex('paint-100')).toMatch(/^#[0-9a-f]{6}$/)
    expect(() => worldHex('nope-100')).toThrow(/unknown world token/)
  })

  it('projects every home like the server does', () => {
    for (const point of homePoints()) {
      const home = homes[point.id as keyof typeof homes]
      const at = project(home.location)
      expect(point).toEqual({ id: point.id, x: Math.round(at.x), y: Math.round(at.y) })
    }
  })

  it('names every area from copy', () => {
    const names = areaNames()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name.text.length).toBeGreaterThan(0)
    expect(names.map((name) => name.text)).toContain('East River')
  })
})
