import { describe, expect, it } from 'vitest'
import { placesLayer } from '@/lib/world/placesLayer'
import { placeIconGroup } from '@/lib/world/placeIcons'
import type { GeoPin } from '../geo/schema'
import { LANDMARK_CHIPS_NAME } from '../landmarks/nameChips'
import {
  CHIPS_MESH_NAME,
  overlaps,
  pickLabels,
  planMarks,
  shortName,
  type Rect,
} from './buildPinMarks'

const pins = placesLayer.pins as readonly GeoPin[]
const rect = (left: number, top: number, w = 10, h = 10): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
})

describe('pin marks plan (S04k)', () => {
  const layout = planMarks(pins, 20)

  it('marks every playable pin, and never a memorial or a teaser', () => {
    const marked = new Set(layout.plans.map((plan) => plan.pin.id))
    for (const pin of pins) expect(marked.has(pin.id)).toBe(pin.style === 'normal')
  })

  it('gives each pin the icon of its category group, one atlas cell per kind and group', () => {
    for (const plan of layout.plans) {
      const icon = layout.icons[plan.iconCell]
      expect(icon).toEqual({
        kind: plan.pin.kind,
        group: placeIconGroup(plan.pin.category as never),
      })
    }
    const keys = layout.icons.map((icon) => `${icon.kind}|${icon.group}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('labels venues and unmodelled landmarks; a modelled landmark keeps its name chip instead', () => {
    for (const plan of layout.plans) {
      if (plan.pin.badge === true) expect(plan.labelCell).toBe(-1)
      else expect(plan.text).toBe(shortName(plan.pin.name, 20))
    }
    expect(layout.labels.length).toBe(layout.plans.filter((plan) => plan.labelCell >= 0).length)
  })

  it('leaves a pin without a name unlabelled', () => {
    const only = planMarks(
      pins.map((pin) => ({ ...pin, name: '' })),
      20,
    )
    expect(only.labels).toEqual([])
    expect(only.plans.every((plan) => plan.labelCell === -1)).toBe(true)
  })

  it('labels with the name the server resolved from copy', () => {
    expect(pins.every((pin) => pin.name.length > 0)).toBe(true)
  })
})

describe('chip mesh name', () => {
  it('matches the landmark name chips mesh, which labels keep clear of', () => {
    expect(CHIPS_MESH_NAME).toBe(LANDMARK_CHIPS_NAME)
  })
})

describe('shortName', () => {
  it('keeps short names and cuts long ones at a word with an ellipsis', () => {
    expect(shortName('Steam Vent Coffee', 20)).toBe('Steam Vent Coffee')
    expect(shortName("Nena's Window Arepas and More", 20)).toBe("Nena's Window…")
    expect(shortName('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…')
    expect(shortName("Nena's Window Arepas and More", 20).length).toBeLessThanOrEqual(21)
  })
})

describe('pickLabels', () => {
  it('places the nearest first, skips any that cover an obstacle or a placed label', () => {
    const candidates = [
      { index: 0, distance: 30, rect: rect(0, 0) },
      { index: 1, distance: 10, rect: rect(5, 5) },
      { index: 2, distance: 20, rect: rect(100, 0) },
      { index: 3, distance: 5, rect: rect(200, 0) },
    ]
    // 3 is nearest but sits on a chip; 1 then 2; 0 overlaps 1.
    expect(pickLabels(candidates, [rect(195, 0)], 6)).toEqual([1, 2])
  })

  it('stops at the cap', () => {
    const candidates = [0, 1, 2].map((i) => ({ index: i, distance: i, rect: rect(i * 50, 0) }))
    expect(pickLabels(candidates, [], 2)).toEqual([0, 1])
    expect(pickLabels(candidates, [], 0)).toEqual([])
  })

  it('treats touching rectangles as clear', () => {
    expect(overlaps(rect(0, 0), rect(10, 0))).toBe(false)
    expect(overlaps(rect(0, 0), rect(9, 9))).toBe(true)
  })
})
