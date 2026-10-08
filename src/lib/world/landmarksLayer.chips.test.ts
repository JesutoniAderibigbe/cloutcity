import { describe, expect, it } from 'vitest'
import { scene } from '@/lib/data/config'
import { chipShifts, landmarkPinLifts, landmarksLayer } from './landmarksLayer'

const chips = scene.landmarkChips
const gap = chips.heightM * 0.15
const polar = scene.camera.polarDeg.default
const rise = Math.tan((polar * Math.PI) / 180)

/** Chip rectangles (apparent centre from the default camera), shifts applied. */
function placed() {
  const lifts = landmarkPinLifts()
  return landmarksLayer.models.map((entry) => ({
    id: entry.id,
    x: entry.frame.anchor.x,
    y:
      entry.frame.anchor.y -
      chips.offsetM +
      (entry.chipShiftM ?? 0) +
      (lifts.get(entry.id) ?? 0) * rise,
  }))
}

describe('landmark name chip layout (UX-14)', () => {
  it('no two name chips overlap', () => {
    const list = placed()
    for (const a of list) {
      for (const b of list) {
        if (a.id >= b.id) continue
        const clear = Math.abs(a.x - b.x) >= chips.widthM || Math.abs(a.y - b.y) >= chips.heightM
        expect(clear, `${a.id} / ${b.id}`).toBe(true)
      }
    }
  })

  it('moves the 42nd St terminal chip off the Deco spire chip when the two would overlap', () => {
    // At the S04l chip size (scaled for the 1100 m default view) the two clear each other; the
    // layout shifts one only when their unshifted chips would collide.
    const lifts = landmarkPinLifts()
    const pair = landmarksLayer.models.filter((entry) =>
      /deco-spire|midtown-terminal/.test(entry.id),
    )
    const [a, b] = pair.map((entry) => ({
      x: entry.frame.anchor.x,
      y: entry.frame.anchor.y + (lifts.get(entry.id) ?? 0) * rise,
    }))
    if (a === undefined || b === undefined) throw new Error('both landmarks are in the layer')
    const overlap = Math.abs(a.x - b.x) < chips.widthM && Math.abs(a.y - b.y) < chips.heightM
    const shifted = pair.some((entry) => entry.chipShiftM !== undefined)
    expect(shifted).toBe(overlap)
  })

  it('leaves lone chips where they were, and moves an overlapping one south below it', () => {
    const shifts = chipShifts(
      [
        { id: 'a', x: 0, y: 1000, liftM: 0 },
        { id: 'b', x: 100, y: 900, liftM: 0 },
        { id: 'c', x: 5000, y: 900, liftM: 0 },
      ],
      chips,
      polar,
    )
    expect(shifts.has('a')).toBe(false)
    expect(shifts.has('c')).toBe(false)
    const b = shifts.get('b') ?? 0
    // b ends up a chip height plus the gap below a.
    expect(900 - chips.offsetM + b).toBeLessThanOrEqual(
      1000 - chips.offsetM - chips.heightM - gap + 1,
    )
  })

  it('reads a raised chip as further north: the tall model chip is placed first', () => {
    const shifts = chipShifts(
      [
        { id: 'low', x: 0, y: 1000, liftM: 0 },
        { id: 'tall', x: 0, y: 900, liftM: 100 },
      ],
      chips,
      polar,
    )
    expect(shifts.has('tall')).toBe(false)
    expect(shifts.get('low') ?? 0).toBeLessThan(0)
  })

  it('is deterministic whatever the input order', () => {
    const anchors = [
      { id: 'a', x: 0, y: 1000, liftM: 0 },
      { id: 'b', x: 100, y: 900, liftM: 0 },
      { id: 'c', x: 50, y: 950, liftM: 300 },
    ]
    expect([...chipShifts(anchors, chips, polar)].sort()).toEqual(
      [...chipShifts([...anchors].reverse(), chips, polar)].sort(),
    )
  })
})
