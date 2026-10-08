import { describe, expect, it } from 'vitest'
import { BoxGeometry, Matrix4, Mesh, PerspectiveCamera, type InstancedMesh } from 'three'
import sceneJson from '@data/config/scene.json'
import finishesJson from '@data/homes/finishes.json'
import itemsJson from '@data/items/items.json'
import { HOME_IDS } from '@/lib/data/homes'
import { buildApartment, mergeMeshes, type PlacedFill } from './buildApartment'
import { buildDecorModel, DECOR_MODEL_IDS } from './buildDecor'
import { buildRoomGeometry, hiddenWalls, ROOM_SECTIONS, roomBounds, shownRanges } from './buildRoom'
import {
  apartmentConfig,
  avatarReserve,
  dayNightConfig,
  dayNightModel,
  finishLook,
  roomInterior,
  roomPalette,
  tierBudget,
  tokenHex,
  toonRamp,
} from './data'
import { boundingSphere, boxCorners, cameraPosition, fitDistance, tightDistance } from './fit'
import { lightingAt as cityLightingAt, mixHexLinear } from '@/lib/dayNight/lightingAt'
import { lightingAt } from './lighting'
import { triangleCount } from './parts'
import { createPlaceholderVisuals } from './visuals'

const modelled = new Set(Object.keys(sceneJson.models.decor))
const decorItems = itemsJson.items.filter((item) => item.category === 'decor')

describe('apartment data', () => {
  it('reads every home interior: its grid, openings, fixtures and the avatar on its cell', () => {
    for (const home of HOME_IDS) {
      const interior = roomInterior(home)
      expect(interior.room.widthM).toBe(interior.grid.cols * interior.grid.cellM)
      expect(interior.room.depthM).toBe(interior.grid.rows * interior.grid.cellM)
      expect(interior.openings.some((opening) => opening.kind === 'door')).toBe(true)
      for (const opening of interior.openings) {
        const length = opening.wall === 'back' ? interior.room.widthM : interior.room.depthM
        expect(Math.abs(opening.centerM) + opening.widthM / 2).toBeLessThanOrEqual(length / 2)
      }
      const [x, , z] = interior.avatarAnchor.position
      expect(Math.abs(x)).toBeLessThan(interior.room.widthM / 2)
      expect(Math.abs(z)).toBeLessThan(interior.room.depthM / 2)
    }
  })

  it('resolves every finish to a pattern and two hex colours, and refuses an unknown one', () => {
    for (const finish of finishesJson.finishes) {
      const look = finishLook(finish.id)
      expect(look.kind).toBe(finish.kind)
      for (const hex of look.colors) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(() => finishLook('plaid')).toThrow(/unknown finish/)
  })

  it('resolves the room palette to hex and keeps the avatar reserve inside every tier', () => {
    for (const hex of Object.values(roomPalette)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(() => tokenHex('no-such-token')).toThrow(/unknown palette token/)
    for (const tier of ['low', 'mid', 'high'] as const) {
      const budget = tierBudget(tier)
      expect(avatarReserve.drawCalls).toBeLessThan(budget.drawCallsMax)
      expect(avatarReserve.triangles).toBeLessThan(budget.trianglesMax)
    }
    expect(tierBudget('high').shadows).toBe('pcf-directional')
    expect(tierBudget('mid').shadows).toBe('blob-or-baked')
    expect(tierBudget('low').shadows).toBe('none')
  })
})

describe('decor models', () => {
  it('draws every decor item: a hand-made model (S04h) or a code-built one of its own', () => {
    const codeBuilt = new Set(DECOR_MODEL_IDS)
    for (const item of decorItems) {
      expect(modelled.has(item.id) || codeBuilt.has(item.id), item.id).toBe(true)
    }
    // Anything else gets the plain stand-in block until its model arrives.
    expect(buildDecorModel('cargo-pants').sizeM.w).toBeGreaterThan(0)
  })

  it('builds each as one merged geometry with at most two material groups, low-poly', () => {
    for (const id of DECOR_MODEL_IDS) {
      const model = buildDecorModel(id)
      const groups = model.geometry.groups.length
      expect(groups, id).toBeLessThanOrEqual(2)
      expect(model.second === null ? groups <= 1 : groups === 2, id).toBe(true)
      expect(triangleCount(model.geometry), id).toBeGreaterThan(0)
      expect(triangleCount(model.geometry), id).toBeLessThan(1500)
      expect(model.footprintM).toBeGreaterThan(0)
      model.geometry.dispose()
    }
  })
})

describe('room shell', () => {
  it('is one vertex-coloured geometry, grouped by wall, for every home and finish, within budget', () => {
    for (const home of HOME_IDS) {
      const interior = roomInterior(home)
      for (const finish of finishesJson.finishes) {
        const finishes =
          finish.kind === 'wall'
            ? { wall: finish.id, floor: interior.shell.floorFinish }
            : { wall: interior.shell.wallPaint, floor: finish.id }
        const geometry = buildRoomGeometry(interior, apartmentConfig, roomPalette, finishes)
        expect(geometry.getAttribute('color')).toBeDefined()
        // One group per section, all on the one material, covering the geometry end to end.
        expect(geometry.groups).toHaveLength(ROOM_SECTIONS.length)
        let next = 0
        for (const group of geometry.groups) {
          expect(group.materialIndex).toBe(0)
          expect(group.start).toBe(next)
          expect(group.count).toBeGreaterThan(0)
          next += group.count
        }
        expect(next).toBe(geometry.getAttribute('position').count)
        // Room for the avatar and the furniture inside the low tier's triangle cap.
        expect(triangleCount(geometry), `${home} ${finish.id}`).toBeLessThan(
          tierBudget('low').trianglesMax / 3,
        )
        geometry.dispose()
      }
    }
  })
})

describe('turned cutaway (S40b)', () => {
  const room = roomInterior('queens-room').room
  const halfW = room.widthM / 2
  const halfD = room.depthM / 2

  it('hides only the walls whose outer face the camera can see', () => {
    expect([...hiddenWalls(room, 0, halfD + 5)]).toEqual([])
    expect([...hiddenWalls(room, 0, -halfD - 1)]).toEqual(['back'])
    expect([...hiddenWalls(room, -halfW - 1, 0)]).toEqual(['left'])
    expect([...hiddenWalls(room, halfW + 1, 0)]).toEqual(['right'])
    expect([...hiddenWalls(room, -halfW - 1, -halfD - 1)].sort()).toEqual(['back', 'left'])
  })

  it('draws the shown sections in at most two ranges, base always', () => {
    // back, left, base, right: 10, 20, 30, 40 vertices.
    const sections = [
      { start: 0, count: 10 },
      { start: 10, count: 20 },
      { start: 30, count: 30 },
      { start: 60, count: 40 },
    ]
    const ranges = (walls: string[]) =>
      shownRanges(sections, new Set(walls as ('back' | 'left' | 'right')[])).map(
        ({ start, count }) => [start, count],
      )
    expect(ranges([])).toEqual([[0, 100]])
    expect(ranges(['back'])).toEqual([[10, 90]])
    expect(ranges(['left'])).toEqual([
      [0, 10],
      [30, 70],
    ])
    expect(ranges(['right'])).toEqual([[0, 60]])
    expect(ranges(['back', 'left'])).toEqual([[30, 70]])
    expect(ranges(['back', 'right'])).toEqual([[10, 50]])
  })
})

describe('camera fit', () => {
  const sphere = boundingSphere([-1, 0, -1], [1, 2, 1])

  it('puts the sphere around the box', () => {
    expect(sphere.center).toEqual([0, 1, 0])
    expect(sphere.radius).toBeCloseTo(Math.sqrt(3))
  })

  it('backs off further for a shorter free row and never fits a zero row to nothing', () => {
    const view = { fovDeg: 50, width: 390, height: 844, margin: 1 }
    const tall = fitDistance(sphere, { ...view, rowHeight: 600 })
    const short = fitDistance(sphere, { ...view, rowHeight: 200 })
    expect(short).toBeGreaterThan(tall)
    expect(fitDistance(sphere, { ...view, rowHeight: 0 })).toBeGreaterThan(0)
  })

  it('keeps the data direction', () => {
    const at = cameraPosition([0, 1, 0], [0, 1, 5], [0, 1, 0], 10)
    expect(at).toEqual([0, 1, 10])
    expect(() => cameraPosition([0, 0, 0], [1, 1, 1], [1, 1, 1], 5)).toThrow(/coincide/)
  })
})

describe('lighting seam (S04f)', () => {
  const input = {
    model: dayNightModel,
    room: dayNightConfig.room,
    lights: apartmentConfig.lights,
    palette: roomPalette,
  }
  const city = (minute: number) => cityLightingAt(minute, dayNightModel)

  it('follows the city keyframe by minute of day, scaled for the room', () => {
    const noon = lightingAt(720, input)
    expect(noon.sun.color).toBe(city(720).colors.sun)
    expect(noon.sun.intensity).toBeCloseTo(city(720).sunIntensity * input.room.sunScale)
    expect(noon.ambient.intensity).toBeCloseTo(city(720).ambientIntensity * input.room.ambientScale)
    // The save's clock is absolute: day 3 at noon lights like day 1 at noon.
    expect(lightingAt(720 + 2 * 1440, input)).toEqual(noon)
    // The sun keeps coming through the window.
    expect(noon.sun.direction).toEqual(apartmentConfig.lights.sunDirection)
  })

  it('is lamp-lit at night: warm ambient, the lamps glowing, the sun dimmer than by day', () => {
    const noon = lightingAt(720, input)
    const night = lightingAt(23 * 60, input)
    expect(city(23 * 60).nightGlow).toBe(1)
    expect(night.glow).toBe(1)
    expect(noon.glow).toBe(0)
    expect(night.sun.intensity).toBeLessThan(noon.sun.intensity)
    expect(night.ambient.intensity).toBeCloseTo(
      city(23 * 60).ambientIntensity * input.room.ambientScale + input.room.lampBoost,
    )
    expect(night.ambient.color).not.toBe(city(23 * 60).colors.ambient)
    expect(night.ambient.color).toBe(
      mixHexLinear(city(23 * 60).colors.ambient, roomPalette.lamp, input.room.lampMix),
    )
    expect(noon.ambient.color).toBe(city(720).colors.ambient)
  })

  it('steps between keyframes under reduced motion', () => {
    // 06:30 blends dawn into morning; step mode shows dawn as is.
    expect(lightingAt(390, { ...input, step: true })).toEqual(lightingAt(345, input))
  })
})

describe('apartment scene graph', () => {
  const interior = roomInterior('queens-room')
  const build = () =>
    buildApartment(
      interior,
      apartmentConfig,
      roomPalette,
      createPlaceholderVisuals(apartmentConfig, roomPalette, toonRamp),
      { wall: interior.shell.wallPaint, floor: interior.shell.floorFinish },
    )
  const fill = (
    itemId: string,
    slotId: string,
    patch: Partial<PlacedFill> = {},
  ): Record<string, PlacedFill> => ({
    [itemId]: {
      itemId,
      slotId,
      turn: 0,
      mount: 'wall',
      footprint: '1x1',
      color: '#ffffff',
      ...patch,
    },
  })
  const decorObjects = (apartment: ReturnType<typeof build>) =>
    apartment.group.getObjectByName('apartment-decor')?.children ?? []

  it('draws each placed item once and swaps it when the colour changes', () => {
    const apartment = build()
    apartment.setPlaced(fill('fairy-string-lights', 'w-back-0'))
    expect(apartment.drawnItems()).toEqual(['fairy-string-lights'])
    const first = decorObjects(apartment)[0]
    apartment.setPlaced(fill('fairy-string-lights', 'w-back-1'))
    expect(decorObjects(apartment)[0]).toBe(first)
    apartment.setPlaced(fill('fairy-string-lights', 'w-back-1', { color: '#ff0000' }))
    expect(decorObjects(apartment)[0]).not.toBe(first)
    apartment.setPlaced({})
    expect(apartment.drawnItems()).toEqual([])
    apartment.dispose()
  })

  it('centres a 2×1 item on its two cells, turned, and stands a surface item on a table', () => {
    const apartment = build()
    apartment.setPlaced({
      ...fill('corduroy-sofa', 'f3-1', { mount: 'floor', footprint: '2x1', turn: 0 }),
      ...fill('windowsill-monstera', 'f0-3', { mount: 'surface', footprint: '1x1', turn: 1 }),
    })
    const objects = decorObjects(apartment)
    const sofa = objects.find((child) => child.name === 'apartment-decor-corduroy-sofa')
    const plant = objects.find((child) => child.name === 'apartment-decor-windowsill-monstera')
    const [x34, z1] = [-interior.room.widthM / 2 + 4, -interior.room.depthM / 2 + 1.5]
    expect(sofa?.position.x).toBeCloseTo(x34)
    expect(sofa?.position.z).toBeCloseTo(z1)
    expect(plant?.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(plant?.position.y).toBeCloseTo(apartmentConfig.standHeightM)
    expect(apartment.group.getObjectByName('apartment-stands')).toBeDefined()
    apartment.dispose()
  })

  it('shows buy mode’s grid in one instanced mesh, hidden while closed; blobs only on the mid tier', () => {
    const apartment = build()
    const tiles = apartment.group.getObjectByName('apartment-grid') as InstancedMesh
    const blobs = apartment.group.getObjectByName('apartment-blob-shadows') as InstancedMesh
    expect(tiles.count).toBe(apartment.slots.length)
    expect(tiles.visible).toBe(false)
    apartment.setCells({ 'f3-1': 'free', 'f4-1': 'ghost' })
    expect(tiles.visible).toBe(true)
    expect(apartment.gridCells()).toEqual({ 'f3-1': 'free', 'f4-1': 'ghost' })
    apartment.setCells(null)
    expect(tiles.visible).toBe(false)
    apartment.setPlaced(fill('cloud-lounge-chair', 'f3-1', { mount: 'floor' }))
    apartment.setTier('mid')
    expect(blobs.visible).toBe(true)
    apartment.setTier('low')
    expect(blobs.visible).toBe(false)
    // The room is rebuilt for the tier through the visuals seam, and stays one object.
    apartment.setTier('high')
    expect(
      apartment.group.children.filter((child) => child.name === 'apartment-room'),
    ).toHaveLength(1)
    apartment.dispose()
  })

  it('rebuilds the shell when a finish is tried on, and only then', () => {
    const apartment = build()
    const room = apartment.group.getObjectByName('apartment-room')
    apartment.setFinishes({ wall: interior.shell.wallPaint, floor: interior.shell.floorFinish })
    expect(apartment.group.getObjectByName('apartment-room')).toBe(room)
    apartment.setFinishes({ wall: 'mint-fresh', floor: 'marble-tile' })
    expect(apartment.group.getObjectByName('apartment-room')).not.toBe(room)
    apartment.dispose()
  })

  it('finds the floor or wall cell under a tap, and projects every cell back to the screen', () => {
    const apartment = build()
    const camera = new PerspectiveCamera(40, 390 / 844, 0.05, 100)
    const bounds = roomBounds(interior, apartmentConfig)
    const sphere = boundingSphere(bounds.min, bounds.max)
    camera.position.set(
      ...cameraPosition(sphere.center, interior.camera.position, interior.camera.target, 22),
    )
    camera.lookAt(...sphere.center)
    camera.updateMatrixWorld()
    for (const slotId of ['f0-0', 'f3-1', 'f4-3', 'w-back-2', 'w-left-0', 'w-right-1']) {
      const point = apartment.cellScreen(camera, slotId, 390, 844)
      if (point === null) throw new Error(`${slotId} is behind the camera`)
      expect(point.x, slotId).toBeGreaterThan(0)
      expect(point.x, slotId).toBeLessThan(390)
      expect(apartment.cellAt(camera, point.x, point.y, 390, 844), slotId).toBe(slotId)
    }
    // Off the room: nothing.
    expect(apartment.cellAt(camera, 2, 2, 390, 844)).toBeNull()
    apartment.dispose()
  })
})

describe('apartment scene graph, turned (S40b)', () => {
  const interior = roomInterior('queens-room')

  it('drops a hidden wall with its decor, grid cells and taps, and brings it back', () => {
    const apartment = buildApartment(
      interior,
      apartmentConfig,
      roomPalette,
      createPlaceholderVisuals(apartmentConfig, roomPalette, toonRamp),
      { wall: interior.shell.wallPaint, floor: interior.shell.floorFinish },
    )
    const fills: Record<string, PlacedFill> = {
      'fairy-string-lights': {
        itemId: 'fairy-string-lights',
        slotId: 'w-back-0',
        turn: 0,
        mount: 'wall',
        footprint: '1x1',
        color: '#ffffff',
      },
    }
    apartment.setPlaced(fills)
    apartment.setCells({ 'w-back-1': 'free', 'f0-0': 'free' })
    const room = apartment.group.getObjectByName('apartment-room') as Mesh
    const lights = apartment.group.getObjectByName('apartment-decor-fairy-string-lights')
    const tiles = apartment.group.getObjectByName('apartment-grid') as InstancedMesh
    const tileScale = (slotId: string) => {
      const matrix = new Matrix4()
      tiles.getMatrixAt(
        apartment.slots.findIndex((slot) => slot.id === slotId),
        matrix,
      )
      return matrix.getMaxScaleOnAxis()
    }
    // Built whole: the four sections join into one draw range.
    expect(room.geometry.groups).toHaveLength(1)
    expect(apartment.setHiddenWalls(new Set())).toBe(false)

    expect(apartment.setHiddenWalls(new Set(['back']))).toBe(true)
    expect(apartment.setHiddenWalls(new Set(['back']))).toBe(false)
    expect(room.geometry.groups).toHaveLength(1)
    expect(room.geometry.groups[0]?.start).toBeGreaterThan(0)
    expect(lights?.visible).toBe(false)
    expect(tileScale('w-back-1')).toBe(0)
    expect(tileScale('f0-0')).toBeGreaterThan(0)

    // A camera behind the back wall looking in: the back wall no longer catches the tap.
    const camera = new PerspectiveCamera(40, 1, 0.05, 100)
    camera.position.set(0, 1.3, -interior.room.depthM / 2 - 4)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    expect(apartment.cellAt(camera, 0.5, 0.5, 1, 1)).toMatch(/^f/)

    // A finish rebuild keeps the cut.
    apartment.setFinishes({ wall: 'mint-fresh', floor: interior.shell.floorFinish })
    const rebuilt = apartment.group.getObjectByName('apartment-room') as Mesh
    expect(rebuilt.geometry.groups[0]?.start).toBeGreaterThan(0)

    expect(apartment.setHiddenWalls(new Set())).toBe(true)
    expect(rebuilt.geometry.groups).toEqual([
      { start: 0, count: rebuilt.geometry.getAttribute('position').count, materialIndex: 0 },
    ])
    expect(lights?.visible).toBe(true)
    expect(tileScale('w-back-1')).toBeGreaterThan(0)
    apartment.dispose()
  })
})

describe('mergeMeshes', () => {
  it('merges meshes into one indexed geometry in group space, quantized or float', () => {
    const a = new BoxGeometry(1, 1, 1)
    const b = new BoxGeometry(1, 1, 1).toNonIndexed()
    const merged = mergeMeshes([
      { geometry: a, matrix: new Matrix4() },
      { geometry: b, matrix: new Matrix4().makeTranslation(5, 0, 0) },
    ])
    expect(merged.getAttribute('position').count).toBe(
      a.getAttribute('position').count + b.getAttribute('position').count,
    )
    merged.computeBoundingBox()
    expect(merged.boundingBox?.max.x).toBeCloseTo(5.5)
    // Missing colours read as white; missing night glow as none.
    expect(merged.getAttribute('color').getX(0)).toBe(1)
    expect(merged.getAttribute('_emissive').getX(0)).toBe(0)
  })
})

describe('tight camera fit (S04k)', () => {
  it('lists the eight corners of a box', () => {
    const corners = boxCorners([0, 0, 0], [1, 2, 3])
    expect(corners).toHaveLength(8)
    expect(new Set(corners.map((c) => c.join(','))).size).toBe(8)
  })

  // A pinhole projection: size on screen is size / distance * focal.
  const measure = (size: { w: number; h: number }) => (distance: number) => {
    const focal = 1000
    const w = (size.w / distance) * focal
    const h = (size.h / distance) * focal
    return { left: 400 - w / 2, right: 400 + w / 2, top: 300 - h / 2, bottom: 300 + h / 2 }
  }

  it('fills the limiting side of the area, less the margin', () => {
    const area = { width: 800, height: 300 }
    const d = tightDistance(10, measure({ w: 4, h: 3 }), area, 1.1)
    const box = measure({ w: 4, h: 3 })(d)
    expect((box.bottom - box.top) * 1.1).toBeCloseTo(300, 3)
    expect(box.right - box.left).toBeLessThan(800)
  })

  it('brings the camera closer than the bounding-sphere fit', () => {
    const sphere = boundingSphere([-1, 0, -1], [1, 2, 1])
    const view = { fovDeg: 40, width: 800, height: 600, rowHeight: 600, margin: 1.06 }
    const start = fitDistance(sphere, view)
    const d = tightDistance(start, measure({ w: 2, h: 2 }), { width: 800, height: 600 }, 1.06)
    expect(d).toBeLessThan(start)
  })
})
