/**
 * data/places/game-points.derived.json and game-gates.derived.json (S04s) are the game map's
 * layout as travel reads it (gameTrips.ts). They must always equal what the places layer plans:
 * after changing the venues, landmarks, homes, geo or data/config/compactLayout.json, run
 * `npm run places:update` and commit the result.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import homesJson from '@data/homes/homes.json'
import { compactLayout } from '@/lib/data/config'
import type { Borough } from '@/lib/data/schemas/content'
import { deriveGameTrips } from './gameTrips'
import { placesLayer } from './placesLayer'

const FILES = {
  points: '../../../data/places/game-points.derived.json',
  gates: '../../../data/places/game-gates.derived.json',
} as const

// toMatchFileSnapshot would quietly write a missing file, so a deleted one would pass.
for (const file of Object.values(FILES)) {
  if (!existsSync(new URL(file, import.meta.url))) {
    throw new Error(`${file} is missing: run \`npm run places:update\` and commit it`)
  }
}

const ringHome = compactLayout.landmarkRing?.aroundHome
const ringBorough =
  ringHome === undefined
    ? null
    : ((homesJson.homes as Record<string, { borough: string }>)[ringHome]?.borough as Borough)

describe('the game map trip tables', () => {
  const derived = deriveGameTrips(placesLayer.pins, ringBorough)

  it.each(Object.keys(FILES) as (keyof typeof FILES)[])(
    'data/places/game-%s.derived.json is what the places layer plans (run `npm run places:update`)',
    async (part) => {
      await expect(`${JSON.stringify(derived[part], null, 2)}\n`).toMatchFileSnapshot(
        FILES[part],
        'The game map layout changed: run `npm run places:update` and commit the derived files.',
      )
    },
  )

  it('moves the ring landmarks into the ring home borough and keeps every venue in its own', () => {
    expect(ringBorough).toBe('queens')
    const gated = Object.keys(derived.gates.gates)
    expect(gated).toContain('statue-of-liberty')
    for (const pin of placesLayer.pins) {
      if (pin.kind === 'venue') expect(derived.gates.gates[pin.id]).toBeUndefined()
      if (pin.gx !== undefined) expect(derived.points.points[pin.id]).toBeDefined()
    }
  })
})
