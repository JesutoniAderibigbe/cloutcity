import { describe, expect, it } from 'vitest'
import { plots, theme } from '@/lib/data/config'
import { venues } from '@/lib/data/content'
import { modelRef } from '@/lib/data/models'
import {
  buildingScale,
  inClearing,
  planPlots,
  plotClearings,
  plotModels,
  plotPinLifts,
  plotPlaces,
  plotTokens,
} from './venuePlots'

const pin = (id: string, category: string, x = 0, y = 0, kind = 'venue', style = 'normal') => ({
  id,
  kind,
  category,
  style,
  x,
  y,
})

describe('place plots (S04m)', () => {
  it('gives every venue type and homes a style in plots.json', () => {
    for (const type of new Set(venues.map((venue) => venue.type))) {
      expect(plots.styles[type], type).toBeDefined()
    }
    expect(plots.styles.home).toBeDefined()
  })

  it('plans one plot per venue and home, never for landmarks, teasers or memorials', () => {
    const places = plotPlaces(
      [
        pin('a', 'bodega'),
        pin('b', 'park', 0, 0, 'landmark'),
        pin('c', 'gym', 0, 0, 'venue', 'teaser'),
        pin('d', 'unknown-type'),
      ],
      [{ id: 'queens-room', x: 10, y: 20 }],
    )
    expect(planPlots(places, plots).map((plan) => plan.id)).toEqual(['queens-room', 'a'])
  })

  it('stands the building north of the point and keeps trees and bushes on the plot', () => {
    const [plan] = planPlots(plotPlaces([pin('a', 'bodega', 100, 200)], []), plots)
    if (plan === undefined) throw new Error('no plan')
    expect(plan.building?.y).toBe(200 + plots.buildingBackM)
    expect(plan.building?.slots).toEqual({ facade: plots.styles.bodega?.facade })
    const half = plots.plotM / 2
    for (const part of plan.dressing) {
      expect(Math.abs(part.x - 100)).toBeLessThanOrEqual(half)
      expect(Math.abs(part.y - 200)).toBeLessThanOrEqual(half)
    }
  })

  it('clears a square of plot plus clearance around each plot', () => {
    const clearings = plotClearings([{ x: 0, y: 0 }], plots)
    const edge = plots.plotM / 2 + plots.clearM
    expect(inClearing({ x: edge, y: -edge }, clearings)).toBe(true)
    expect(inClearing({ x: edge + 1, y: 0 }, clearings)).toBe(false)
    expect(inClearing({ x: edge + 1, y: 0 }, clearings, 2)).toBe(true)
  })

  it('recolours only the one slot each plot model has, in its first place', () => {
    // The plots chunk numbers a part's slots from its style (src/scene/plots/layer.ts).
    for (const style of Object.values(plots.styles)) {
      if (style.model !== null && style.facade !== null) {
        expect(modelRef(style.model).slots, style.model).toEqual(['facade'])
      }
      if (style.awning !== null) expect(modelRef(style.awning.model).slots).toEqual(['canvas'])
    }
    for (const id of [...plots.trees.models, plots.bush.model]) {
      expect(modelRef(id).slots, id).toEqual([])
    }
  })

  it('names only theme tokens and catalogued models', () => {
    const world = { ...theme.world, ...theme.models }
    for (const token of plotTokens(plots)) expect(world[token], token).toBeDefined()
    for (const id of plotModels(plots)) expect(() => modelRef(id), id).not.toThrow()
  })

  it('fits a building by its longer side and lifts its pin over the roof', () => {
    const bounds = { min: [-5, 0, -10] as const, max: [5, 30, 10] as const }
    expect(buildingScale(bounds, 40)).toBe(2)
    const scale = buildingScale(bounds, plots.styles.bodega?.footprintM ?? 0)
    const lifts = plotPinLifts(plotPlaces([pin('a', 'bodega')], []), plots, () => bounds)
    expect(lifts.get('a')).toBe(
      Math.round(plots.slabM + 30 * scale * plots.buildingHeightScale + plots.bubbleClearM),
    )
    // No building (a station's square): the pin stays on the ground.
    expect(
      plotPinLifts(plotPlaces([pin('s', 'subway-station')], []), plots, () => bounds).size,
    ).toBe(0)
  })
})
