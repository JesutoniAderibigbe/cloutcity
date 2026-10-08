/**
 * S40c: the room Sim's floor maths (simWorld.ts) and behaviour (simController.ts), driven with
 * the shipped data and the Queens room's own layout.
 */
import { describe, expect, it } from 'vitest'
import { roomInterior } from '../data'
import type { ApartmentPlacement } from '../types'
import { SimController, rotate, type Body, type SimFrame } from './simController'
import { simData } from './simData'
import {
  buildWorld,
  cellOf,
  findPath,
  isFree,
  placeAnchor,
  reachableNear,
  type P2,
  type SimWorld,
} from './simWorld'

const MODELS: Readonly<Record<string, string>> = {
  'starter-bed': 'bed',
  'starter-sofa': 'couch',
  'starter-rug': 'rug',
  'starter-tv': 'tv',
  'starter-lamp': 'floor-lamp',
  'starter-plant': 'plant',
  'starter-table': 'desk',
  'starter-poster': 'poster',
}

const place = (
  itemId: string,
  slotId: string,
  turn: 0 | 1 | 2 | 3,
  footprint: ApartmentPlacement['footprint'],
  mount: ApartmentPlacement['mount'] = 'floor',
): ApartmentPlacement => ({ itemId, slotId, turn, footprint, mount, token: 'cream-100' })

/** The Queens room as a new game furnishes it (data/homes/interiors.json `starter`). */
const STARTER: readonly ApartmentPlacement[] = [
  place('starter-bed', 'f3-0', 0, '2x2'),
  place('starter-sofa', 'f0-1', 1, '2x1'),
  place('starter-rug', 'f1-1', 0, '2x2'),
  place('starter-tv', 'f3-2', 3, '2x1', 'surface'),
  place('starter-lamp', 'f0-3', 0, '1x1'),
  place('starter-plant', 'f4-2', 0, '1x1'),
  place('starter-table', 'f1-3', 0, '2x1'),
  place('starter-poster', 'w-back-3', 0, '1x1', 'wall'),
]

const queens = roomInterior('queens-room')

function world(placed: readonly ApartmentPlacement[] = STARTER, home = queens): SimWorld {
  return buildWorld({
    grid: home.grid,
    fixtures: home.fixtures.map((fixture) =>
      fixture.kind === 'model'
        ? { kind: 'model', model: fixture.model, slotId: fixture.slotId, turn: fixture.turn }
        : { kind: 'counter', slotId: fixture.slotId, turn: fixture.turn },
    ),
    placed,
    modelOf: (itemId) => MODELS[itemId] ?? null,
    walkable: simData.walkable,
  })
}

const START: Body = { x: 0, y: 0, z: 0.5, yaw: 0, tilt: 0 }

function controller(
  w: SimWorld = world(),
  options: { reducedMotion?: boolean; home?: 'queens-room' | 'brooklyn-1br' } = {},
) {
  return new SimController({
    data: simData,
    home: options.home ?? 'queens-room',
    world: w,
    start: START,
    metresPerRigUnit: 0.95,
    walkClipS: 1.6,
    reducedMotion: options.reducedMotion ?? false,
  })
}

/** Steps the Sim at 60 fps for up to `seconds`, keeping every frame. */
function run(sim: SimController, seconds: number): SimFrame[] {
  const frames: SimFrame[] = []
  for (let t = 0; t < seconds; t += 1 / 60) frames.push(sim.update(1 / 60))
  return frames
}

const onFloor = (frame: SimFrame): P2 => ({ x: frame.body.x, z: frame.body.z })

describe('the room Sim floor (S40c)', () => {
  it('blocks the cells under furniture and fixtures, never under a rug or a wall item', () => {
    const w = world()
    expect(isFree(w, 0, 0)).toBe(false) // fridge
    expect(isFree(w, 1, 0)).toBe(false) // stove
    expect(isFree(w, 3, 0)).toBe(false) // bed
    expect(isFree(w, 4, 1)).toBe(false)
    expect(isFree(w, 0, 2)).toBe(false) // sofa, turned to run front to back
    expect(isFree(w, 1, 1)).toBe(true) // the rug
    expect(isFree(w, 2, 2)).toBe(true) // where the avatar stands
    expect(w.items.some((item) => item.id === 'starter-poster')).toBe(false)
  })

  it('walks around furniture, never through it', () => {
    const w = world()
    const route = findPath(w, { x: 0, z: 0.5 }, { x: -1, z: -0.72 }, simData.walk.clearanceM)
    expect(route).not.toBeNull()
    for (let i = 1; i < (route?.length ?? 0); i++) {
      const a = route?.[i - 1] ?? { x: 0, z: 0 }
      const b = route?.[i] ?? { x: 0, z: 0 }
      for (let t = 0; t <= 1; t += 0.02) {
        const cell = cellOf(w, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
        expect(cell !== null && isFree(w, cell[0], cell[1])).toBe(true)
      }
    }
  })

  it('stops short of a corner furniture boxes in, at the nearest reachable spot', () => {
    const w = world()
    // f4-3 is walled in by the plant, the TV stand and the room's corner.
    const corner = { x: 2, z: 1.5 }
    expect(findPath(w, { x: 0, z: 0.5 }, corner, 0)).toBeNull()
    const target = reachableNear(w, { x: 0, z: 0.5 }, corner)
    expect(target).not.toEqual(corner)
    expect(findPath(w, { x: 0, z: 0.5 }, target, 0)).not.toBeNull()
  })

  it('turns an anchor with its item: a sofa turned toward the right wall seats you facing it', () => {
    const sofa = world().items.find((item) => item.id === 'starter-sofa')
    const seat = simData.anchors.get('couch')?.find((anchor) => anchor.pose === 'sit')
    if (sofa === undefined || seat === undefined) throw new Error('no sofa seat')
    const placed = placeAnchor(sofa, seat)
    expect(placed.headingRad).toBeCloseTo(Math.PI / 2)
    // The approach is in front of the sofa, toward the room.
    expect(placed.approach[0]?.x ?? 0).toBeGreaterThan(sofa.center.x)
  })
})

describe('the room Sim (S40c)', () => {
  it('sleeps: walks to the bed without crossing furniture, lies on it with a bubble, gets up', () => {
    const w = world()
    const sim = controller(w)
    sim.perform('sleep')
    const frames = run(sim, 20)
    const walking = frames.filter((frame) => frame.clip === 'walk')
    expect(walking.length).toBeGreaterThan(0)
    for (const frame of walking) {
      const cell = cellOf(w, onFloor(frame))
      expect(cell !== null && isFree(w, cell[0], cell[1])).toBe(true)
      // The walk clip keeps pace with the body: never faster than the stride allows.
      expect(frame.timeScale).toBeGreaterThanOrEqual(simData.walk.minTimeScale)
    }
    const lying = frames.filter((frame) => frame.bubble === 'home.sim.bubble.sleep')
    expect(lying.length).toBeGreaterThan(0)
    const bed = w.items.find((item) => item.model === 'bed')
    const mattress = lying[0]?.body
    if (bed === undefined || mattress === undefined) throw new Error('never lay down')
    expect(mattress.tilt).toBeCloseTo(-Math.PI / 2)
    expect(
      bed.cells.some(([c, r]) => {
        const cell = cellOf(w, onFloor(lying[0] as SimFrame))
        return cell?.[0] === c && cell[1] === r
      }),
    ).toBe(true)
    // Held for the step's time, then up again and idle with no frames needed.
    const holdS = lying.length / 60
    expect(holdS).toBeCloseTo((simData.actions.get('sleep')?.[0]?.holdMs ?? 0) / 1000, 0)
    const last = frames[frames.length - 1]
    expect(last?.body.tilt).toBe(0)
    expect(last?.clip).toBe('idle')
    expect(last?.active).toBe(false)
  })

  it('cooks at the stove with the pan, then sits down to eat with a plate', () => {
    const sim = controller()
    sim.perform('home-meal')
    const frames = run(sim, 30)
    const cooking = frames.filter((frame) => frame.prop?.id === 'pan')
    expect(cooking.length).toBeGreaterThan(0)
    expect(cooking[0]?.clip).toBe('interact')
    const stove = world().items.find((item) => item.model === 'stove')
    // Facing the stove, which stands behind the Sim (toward the back wall).
    expect(Math.cos(cooking[0]?.body.yaw ?? 0)).toBeCloseTo(-1)
    expect(cooking[0]?.body.z ?? 0).toBeGreaterThan(stove?.center.z ?? 0)
    const eating = frames.filter((frame) => frame.prop?.id === 'plate')
    expect(eating.length).toBeGreaterThan(0)
    expect(eating[0]?.clip).toBe('sit')
  })

  it('lies on the floor spot in a home with no bed or sofa', () => {
    const sim = controller(world([]))
    sim.perform('sleep')
    const frames = run(sim, 12)
    const lying = frames.find((frame) => frame.bubble !== null)
    expect(lying?.body.tilt).toBeCloseTo(-Math.PI / 2)
    expect(lying?.body.y ?? 1).toBeLessThan(0.3)
  })

  it('without a seat to eat on, still eats, standing at the table', () => {
    const noSeats = STARTER.filter(
      (entry) => entry.itemId !== 'starter-sofa' && entry.itemId !== 'starter-bed',
    )
    const sim = controller(world(noSeats))
    sim.perform('home-meal')
    const frames = run(sim, 30)
    const eating = frames.filter((frame) => frame.prop?.id === 'plate')
    expect(eating.length).toBeGreaterThan(0)
    expect(eating[0]?.clip).toBe('talk')
    expect(eating[0]?.body.tilt).toBe(0)
  })

  it('sits on a tapped sofa until the next tap, then gets up and walks there', () => {
    const sim = controller()
    expect(sim.sitOn('starter-sofa')).toBe(true)
    const seated = run(sim, 8)
    const settled = seated[seated.length - 1]
    expect(settled?.clip).toBe('sit')
    expect(settled?.active).toBe(false)
    sim.goTo({ x: 0.2, z: 0.6 })
    const after = run(sim, 8)
    expect(after[0]?.clip).toBe('idle') // getting up first
    expect(after.some((frame) => frame.clip === 'walk')).toBe(true)
    const end = after[after.length - 1]
    expect(end?.body.x).toBeCloseTo(0.2, 1)
    expect(end?.body.z).toBeCloseTo(0.6, 1)
  })

  it('cuts straight to each pose under reduced motion, and needs no frames', () => {
    const sim = controller(world(), { reducedMotion: true })
    sim.perform('sleep')
    const first = sim.update(0)
    expect(first.body.tilt).toBeCloseTo(-Math.PI / 2)
    expect(first.bubble).toBe('home.sim.bubble.sleep')
    expect(first.active).toBe(false)
    expect(sim.wakeInMs()).toBeGreaterThan(0)
    const done = sim.update(10)
    expect(done.body.tilt).toBe(0)
    expect(done.bubble).toBeNull()
  })

  it('an action it has no steps for still shows: a moment standing', () => {
    const sim = controller()
    sim.perform('not-a-home-action')
    expect(sim.update(0.1).clip).toBe('idle')
    expect(sim.wakeInMs()).toBeGreaterThan(0)
  })
})

describe('rotate (S40c)', () => {
  it('lies a body back: its up points where it faced before tilting', () => {
    const up = rotate([0, 1, 0], 0, -Math.PI / 2)
    expect(up[2]).toBeCloseTo(-1)
    const turned = rotate([0, 0, 1], Math.PI / 2, 0)
    expect(turned[0]).toBeCloseTo(1)
  })
})
