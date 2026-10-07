/**
 * data/homes/neighborhoods.json (S16a): the six Queens start neighborhoods the creator rolls.
 * Each home point stands on Queens land, in the zone it names, outside any park, within
 * `maxStationM` of its subway station; and no roll is a handicap: each neighborhood's subway trip
 * to the fairness places is within `fairness.tolerancePct` of the mean over all of them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { homePoint } from '@/engine/neighborhoods'
import { transitConfig } from '@/engine/transit/config'
import { planTrip } from '@/engine/transit/plan'
import { buildTransitWorld } from '@/engine/transit/world'
import { baseCopy } from '@/lib/copy/all'
import { homes, landmarks, venues } from '@/lib/data/content'
import { land, parks, subway, zoneShapes } from '@/lib/data/geo'
import { NeighborhoodsFileSchema } from '@/lib/data/schemas/content'
import { areaAt, prepareAreas } from '@/lib/geo/lookup'
import { distanceM, project } from '@/lib/geo/projection'

const DATA = join(import.meta.dirname, '../../../data')
const file = NeighborhoodsFileSchema.parse(
  JSON.parse(readFileSync(join(DATA, 'homes/neighborhoods.json'), 'utf8')),
)

const boroughAreas = prepareAreas(land.boroughs)
const zoneAreas = prepareAreas(zoneShapes.zones)
const parkAreas = prepareAreas(parks.parks)
const zoneBorough = new Map(
  (
    JSON.parse(readFileSync(join(DATA, 'zones/zones.derived.json'), 'utf8')) as {
      zones: { id: string; borough: string }[]
    }
  ).zones.map((zone) => [zone.id, zone.borough]),
)

const byId = (id: string) => {
  const place = [...venues, ...landmarks].find((entry) => entry.id === id)
  if (place === undefined) throw new Error(`fairness names an unknown place "${id}"`)
  return place
}

describe('start neighborhoods (S16a)', () => {
  it('are the six Queens neighborhoods of the plan, in the engine in the same order', () => {
    expect(file.neighborhoods.map((n) => n.id)).toEqual([
      'astoria',
      'sunnyside',
      'jackson-heights',
      'elmhurst',
      'ridgewood',
      'flushing',
    ])
    expect(file.borough).toBe('queens')
    expect(engineConfig.neighborhoods.map((n) => n.id)).toEqual(file.neighborhoods.map((n) => n.id))
  })

  it.each(file.neighborhoods.map((n) => [n.id, n] as const))(
    '%s: on Queens land, in its zone, not in a park, near its station',
    (_id, neighborhood) => {
      const point = project(neighborhood.home)
      expect(areaAt(point, boroughAreas), 'borough').toBe(file.borough)
      expect(areaAt(point, zoneAreas), 'zoneId').toBe(neighborhood.zoneId)
      expect(zoneBorough.get(neighborhood.zoneId), 'zone borough').toBe(file.borough)
      expect(areaAt(point, parkAreas), 'park').toBeUndefined()
      const station = subway.stations.find((entry) => entry.id === neighborhood.stationId)
      expect(station, 'station').toBeDefined()
      const gap = distanceM(point, { x: station?.x ?? Infinity, y: station?.y ?? Infinity })
      expect(gap).toBeLessThanOrEqual(file.maxStationM)
    },
  )

  it('every name and blurb is in the neighborhoods copy, and every neighborhood offers a startable home', () => {
    for (const neighborhood of file.neighborhoods) {
      expect(baseCopy.strings[neighborhood.nameKey], neighborhood.nameKey).toBeDefined()
      expect(baseCopy.strings[neighborhood.blurbKey], neighborhood.blurbKey).toBeDefined()
      expect(neighborhood.homes).toContain('queens-room')
    }
  })

  it(`trip times are fair: each within ±tolerance of the mean`, () => {
    const world = buildTransitWorld({ subway, land }, transitConfig)
    const noon = 12 * 60
    const minutes = file.neighborhoods.map((neighborhood) => {
      const from = project(neighborhood.home)
      const trips = file.fairness.to.map((id) => {
        const result = planTrip(from, project(byId(id).location), file.fairness.mode, {
          config: transitConfig,
          minuteOfDay: noon,
          world,
        })
        if (!result.ok) throw new Error(`${neighborhood.id} → ${id}: ${result.error.code}`)
        return result.route.durationMin
      })
      return trips.reduce((a, b) => a + b, 0) / trips.length
    })
    const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length
    const band = (mean * file.fairness.tolerancePct) / 100
    for (const [i, trip] of minutes.entries()) {
      const id = file.neighborhoods[i]?.id
      expect(
        Math.abs(trip - mean),
        `${id}: ${trip} min vs mean ${Math.round(mean)} (${minutes.join(', ')})`,
      ).toBeLessThanOrEqual(band)
    }
  })
})

describe('homePoint', () => {
  const sunnyside = file.neighborhoods.find((n) => n.id === 'sunnyside')

  it('is the default home point with no neighborhood, or for a home the neighborhood does not have', () => {
    expect(homePoint('queens-room', null, homes, engineConfig)).toEqual(
      homes['queens-room'].location,
    )
    expect(homePoint('brooklyn-1br', 'sunnyside', homes, engineConfig)).toEqual(
      homes['brooklyn-1br'].location,
    )
    expect(homePoint('queens-room', 'nowhere', homes, engineConfig)).toEqual(
      homes['queens-room'].location,
    )
  })

  it("is the neighborhood's point for one of its startable homes", () => {
    expect(homePoint('queens-room', 'sunnyside', homes, engineConfig)).toEqual(sunnyside?.home)
  })
})
