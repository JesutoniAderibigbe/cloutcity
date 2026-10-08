import { describe, expect, it } from 'vitest'
import { BUILDING_DISTRICT_IDS } from './sources'
import {
  STREET_EXTRA_ZONE_IDS,
  STREET_SOURCE_IDS,
  STREET_ZONE_IDS,
  streetSourceId,
} from './streetSources'

describe('street props source ids (S04i)', () => {
  it('lists the building districts first, then the extra zones, one source each in order', () => {
    expect(STREET_ZONE_IDS).toEqual([...BUILDING_DISTRICT_IDS, ...STREET_EXTRA_ZONE_IDS])
    expect(STREET_SOURCE_IDS).toEqual(STREET_ZONE_IDS.map(streetSourceId))
  })
})
