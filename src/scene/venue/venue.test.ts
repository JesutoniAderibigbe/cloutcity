import { describe, expect, it } from 'vitest'
import { InstancedMesh, Mesh } from 'three'
import { createToonRamp } from '../toonRamp'
import { toonRamp } from '../apartment/data'
import { SimController } from '../apartment/sim/simController'
import { cellOf, isFree } from '../apartment/sim/simWorld'
import { buildVenue } from './buildVenue'
import { crowdConfig, lightsConfig, venueBudget, venueInterior, venueSimData } from './data'

const DEG = Math.PI / 180

function controllerFor(id: string) {
  const interior = venueInterior(id)
  const [x, , z] = interior.room.avatarAnchor.position
  return new SimController({
    data: venueSimData(id),
    home: id,
    world: interior.world,
    start: { x, y: 0, z, yaw: interior.room.avatarAnchor.rotationDeg * DEG, tilt: 0 },
    metresPerRigUnit: 1,
    walkClipS: 1,
    reducedMotion: false,
  })
}

/** Runs the Sim until it holds its pose (a bubble shows, or it sits still); the last frame. */
function settle(sim: SimController, seconds = 30) {
  let frame = sim.update(0)
  for (let t = 0; t < seconds; t += 0.05) {
    frame = sim.update(0.05)
    if (frame.bubble !== null || (!frame.active && t > 1)) return frame
  }
  return frame
}

describe('venue interiors (S43)', () => {
  it('builds the club as an apartment room with its bar and booth seats for the locals', () => {
    const club = venueInterior('club')
    expect(club.room.room.widthM).toBe(12)
    // The bar's cells are blocked; the dance floor is free to walk on.
    expect(isFree(club.world, 0, 1)).toBe(false)
    expect(isFree(club.world, 5, 3)).toBe(true)
    const seats = club.crowdSpots.filter((spot) => spot.pose === 'sit')
    expect(seats.some((spot) => spot.activity === 'bar')).toBe(true)
    expect(seats.some((spot) => spot.activity === 'booth')).toBe(true)
    for (const spot of club.crowdSpots) expect(cellOf(club.world, spot)).not.toBeNull()
  })

  it('dances on the floor for a club night and gets a phone out to flex', () => {
    const sim = controllerFor('club')
    sim.perform('club-night')
    const dancing = settle(sim)
    expect(dancing.clip).toBe('wave')
    expect(dancing.bubble).toBe('place.sim.bubble.dance')
    const floor = venueInterior('club').danceFloor
    expect(floor).not.toBeNull()
    if (floor !== null) {
      expect(dancing.body.x).toBeGreaterThan(floor.x0)
      expect(dancing.body.x).toBeLessThan(floor.x0 + floor.cols * floor.tileM)
    }
    sim.perform('flex')
    const flexing = settle(sim)
    expect(flexing.prop?.id).toBe('phone')
  })

  it('sits on a sofa for a rooftop hang', () => {
    const sim = controllerFor('lounge')
    sim.perform('rooftop-hang')
    const hanging = settle(sim)
    expect(hanging.clip).toBe('sit')
    expect(hanging.bubble).toBe('place.sim.bubble.hang')
  })

  it('sits at the bar when a stool is tapped', () => {
    const club = venueInterior('club')
    const sim = controllerFor('club')
    const stool = club.world.items.find((item) => item.model === 'stool')
    expect(stool).toBeDefined()
    expect(sim.sitOn(stool?.id ?? '')).toBe(true)
    expect(settle(sim).clip).toBe('sit')
  })

  it('draws everything that glows in one instanced mesh and animates it on the beat', () => {
    for (const id of ['club', 'lounge']) {
      const ramp = createToonRamp(toonRamp)
      const pieces = buildVenue(
        venueInterior(id),
        ramp,
        lightsConfig('high').beams,
        lightsConfig('high'),
      )
      const meshes: (Mesh | InstancedMesh)[] = []
      pieces.group.traverse((object) => {
        if (object instanceof Mesh) meshes.push(object)
      })
      // Code-built pieces, the glow, and the club's beams: never more draw calls than that.
      expect(meshes.length).toBeLessThanOrEqual(3)
      expect(pieces.update({ timeS: 0, open: true, glow: 1, still: false })).toBe(true)
      expect(pieces.update({ timeS: 0.01, open: true, glow: 1, still: false })).toBe(id === 'club')
      expect(pieces.update({ timeS: 5, open: true, glow: 1, still: false })).toBe(true)
      expect(pieces.triangles()).toBeGreaterThan(0)
      pieces.dispose()
      ramp.dispose()
    }
  })

  it('keeps the low tier to one body in two clips within its caps', () => {
    const low = crowdConfig('low')
    expect(low.bodies).toBe(1)
    expect(new Set([...low.poses].map((pose) => low.clipOf(pose))).size).toBe(2)
    expect(venueBudget('low').drawCallsMax).toBeGreaterThan(low.bodies * 2 * 4)
  })
})
