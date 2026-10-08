import { describe, expect, it } from 'vitest'
import { recessedPanes } from './recess.ts'

type P = [number, number, number]

/** A quad as two triangles, corners counter-clockwise seen from its front. */
const quad = (a: P, b: P, c: P, d: P): P[][] => [
  [a, b, c],
  [a, c, d],
]

/**
 * A facade facing +z: a wall at z = 0 with a 1 m window opening whose pane sits 0.2 m back,
 * framed by four reveal faces, plus a flush trim strip, a proud frame bar and a sill.
 */
function fixture() {
  const parts: { name: string; tris: P[][]; candidate: boolean }[] = []
  const add = (name: string, candidate: boolean, ...quads: P[][][]) =>
    parts.push({ name, candidate, tris: quads.flat() })
  // Wall around the opening x 0..1, y 1..2 (the wall token never glows).
  add(
    'wall',
    false,
    quad([-1, 0, 0], [2, 0, 0], [2, 1, 0], [-1, 1, 0]),
    quad([-1, 2, 0], [2, 2, 0], [2, 3, 0], [-1, 3, 0]),
    quad([-1, 1, 0], [0, 1, 0], [0, 2, 0], [-1, 2, 0]),
    quad([1, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0]),
  )
  add('pane', true, quad([0, 1, -0.2], [1, 1, -0.2], [1, 2, -0.2], [0, 2, -0.2]))
  // Reveals from the pane (z -0.2) out to the wall (z 0), facing into the opening.
  add(
    'reveals',
    false,
    quad([0, 1, -0.2], [0, 1, 0], [1, 1, 0], [1, 1, -0.2]),
    quad([0, 2, -0.2], [1, 2, -0.2], [1, 2, 0], [0, 2, 0]),
    quad([0, 1, -0.2], [0, 2, -0.2], [0, 2, 0], [0, 1, 0]),
    quad([1, 1, -0.2], [1, 1, 0], [1, 2, 0], [1, 2, -0.2]),
  )
  // Trim painted with the glass colour: flush with the wall, and a bar standing 0.1 m proud.
  add('flush trim', true, quad([-1, 3, 0], [2, 3, 0], [2, 3.3, 0], [-1, 3.3, 0]))
  add(
    'proud bar',
    true,
    quad([-1, 0.5, 0.1], [2, 0.5, 0.1], [2, 0.7, 0.1], [-1, 0.7, 0.1]),
  )
  add(
    'proud bar sides',
    false,
    quad([-1, 0.7, 0], [-1, 0.7, 0.1], [2, 0.7, 0.1], [2, 0.7, 0]),
    quad([-1, 0.5, 0], [2, 0.5, 0], [2, 0.5, 0.1], [-1, 0.5, 0.1]),
  )
  add('sill', true, quad([0, 1, -0.2], [0, 1, 0.1], [1, 1, 0.1], [1, 1, -0.2]))
  const positions: number[] = []
  const candidate: boolean[] = []
  const names: string[] = []
  for (const part of parts) {
    for (const tri of part.tris) {
      for (const p of tri) positions.push(...p)
      candidate.push(part.candidate)
      names.push(part.name)
    }
  }
  return { positions, candidate, names }
}

describe('recessedPanes (GLOW-1)', () => {
  it('lights the recessed pane and nothing painted the same colour around it', () => {
    const { positions, candidate, names } = fixture()
    const glass = recessedPanes(positions, candidate)
    const lit = new Set(names.filter((_, i) => glass[i]))
    expect([...lit]).toEqual(['pane'])
    expect(glass.filter(Boolean)).toHaveLength(2)
  })

  it('never lights a triangle that is not a candidate', () => {
    const { positions, candidate } = fixture()
    const glass = recessedPanes(
      positions,
      candidate.map(() => false),
    )
    expect(glass.some(Boolean)).toBe(false)
  })

  it('a flush pane (no reveals) stays dark', () => {
    const pane = quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]).flat(2)
    expect(recessedPanes(pane, [true, true])).toEqual([false, false])
  })

  it('a pane smaller than the minimum area is a sliver, not a window', () => {
    const { positions, candidate } = fixture()
    const glass = recessedPanes(positions, candidate, {
      maxNormalY: 0.3,
      minRevealShare: 0.6,
      maxInwardShare: 0.1,
      epsM: 1e-3,
      minPaneAreaM2: 2,
    })
    expect(glass.some(Boolean)).toBe(false)
  })

  it('is deterministic', () => {
    const { positions, candidate } = fixture()
    expect(recessedPanes(positions, candidate)).toEqual(recessedPanes(positions, candidate))
  })
})
