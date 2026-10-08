/**
 * The apartment shell (S16, S40): the floor slab with its finish (checker tiles, planks,
 * parquet or a solid pour), walls with thickness and a darker cap read from above like a doll's
 * house, the wall paint (or the loft's exposed brick on the back wall), baseboards and crown
 * moulding, windows with frames, sills, panes and curtains, the door in its frame, and the
 * home's built-in counters. Everything is one vertex-coloured geometry, grouped by wall
 * (ROOM_SECTIONS) so the orbit can leave out the walls between the camera and the room.
 *
 * The cutaway: there is no front wall. From the front the walls' outer faces turn away from the
 * camera and back-face culling hides them; once the player turns the room (S40b) past a wall,
 * `hiddenWalls` names it and the shell draws without it. Trim, panes and doors sit `insetM` in
 * front of their wall so they never fight it in the depth test.
 *
 * Room space (data/homes/interiors.json): metres, x right, y up, z toward the camera, the floor's
 * centre at the origin. Along the back wall an opening's `centerM` runs with x; along a side wall
 * it runs with z.
 */
import { Color, PlaneGeometry, type BufferAttribute, type BufferGeometry } from 'three'
import { parseSlot } from '@/engine/homeGrid'
import {
  cellCenter,
  finishLook,
  type ApartmentConfig,
  type FinishLook,
  type RoomInterior,
  type RoomOpening,
  type RoomPalette,
  type RoomWall,
} from './data'
import { boxAt, mergeParts, paintedPart } from './parts'

type RoomColors = Pick<
  RoomPalette,
  'trim' | 'furniture' | 'window' | 'cap' | 'counter' | 'countertop' | 'curtain'
>

/** The finishes the shell shows (finish ids, data/homes/finishes.json). */
export interface ShellFinishes {
  readonly wall: string
  readonly floor: string
}

/** Recolours the faces of a painted part whose normal points up or toward the camera. */
function capFaces(part: BufferGeometry, hex: string, towardCamera: boolean): BufferGeometry {
  const normal = part.getAttribute('normal')
  const color = part.getAttribute('color') as BufferAttribute
  const { r, g, b } = new Color(hex)
  for (let i = 0; i < normal.count; i++) {
    if (normal.getY(i) > 0.5 || (towardCamera && normal.getZ(i) > 0.5)) color.setXYZ(i, r, g, b)
  }
  return part
}

/** A box from `min` to `max` in one colour. */
function slab(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  hex: string,
): BufferGeometry {
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const at: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ]
  return paintedPart(boxAt(size, at), hex)
}

/** A flat rectangle on the floor (y up) from (x0, z0) to (x1, z1), at height `y`. */
function floorQuad(x0: number, z0: number, x1: number, z1: number, y: number, hex: string) {
  const quad = new PlaneGeometry(x1 - x0, z1 - z0)
  quad.rotateX(-Math.PI / 2)
  quad.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
  return paintedPart(quad, hex)
}

/** The floor's finish as tiles over the whole floor. */
function floorFinishParts(look: FinishLook, room: RoomInterior['room'], lift: number) {
  const parts: BufferGeometry[] = []
  const [a, b] = look.colors
  const halfW = room.widthM / 2
  const halfD = room.depthM / 2
  switch (look.pattern) {
    case 'solid':
    case 'brick':
      parts.push(floorQuad(-halfW, -halfD, halfW, halfD, lift, a))
      break
    case 'checker': {
      const tile = 0.5
      for (let z = -halfD, j = 0; z < halfD - 1e-6; z += tile, j++) {
        for (let x = -halfW, i = 0; x < halfW - 1e-6; x += tile, i++) {
          const x1 = Math.min(halfW, x + tile)
          const z1 = Math.min(halfD, z + tile)
          parts.push(floorQuad(x, z, x1, z1, lift, (i + j) % 2 === 0 ? a : b))
        }
      }
      break
    }
    case 'planks': {
      // Boards run left to right; each row's joints shift so no two rows line up.
      const width = 0.25
      const length = 1.25
      for (let z = -halfD, row = 0; z < halfD - 1e-6; z += width, row++) {
        const z1 = Math.min(halfD, z + width)
        let x = -halfW - ((row * 0.45) % length)
        let board = row
        while (x < halfW - 1e-6) {
          const x0 = Math.max(-halfW, x)
          const x1 = Math.min(halfW, x + length)
          if (x1 > x0) parts.push(floorQuad(x0, z, x1, z1 - 0.012, lift, board % 2 === 0 ? a : b))
          x += length
          board += 1
        }
      }
      break
    }
    case 'herringbone': {
      // Parquet blocks of three staves, each block turned a quarter from its neighbours.
      const block = 0.5
      const stave = block / 3
      for (let z = -halfD, j = 0; z < halfD - 1e-6; z += block, j++) {
        for (let x = -halfW, i = 0; x < halfW - 1e-6; x += block, i++) {
          const x1 = Math.min(halfW, x + block)
          const z1 = Math.min(halfD, z + block)
          for (let k = 0; k < 3; k++) {
            const hex = k === 1 ? b : a
            if ((i + j) % 2 === 0) {
              const s0 = z + k * stave
              if (s0 < z1)
                parts.push(floorQuad(x, s0, x1, Math.min(z1, s0 + stave) - 0.01, lift, hex))
            } else {
              const s0 = x + k * stave
              if (s0 < x1)
                parts.push(floorQuad(s0, z, Math.min(x1, s0 + stave) - 0.01, z1, lift, hex))
            }
          }
        }
      }
      break
    }
  }
  return parts
}

/**
 * A rectangle on a wall's inner face: centred `along` the wall, from `bottom` up `height`,
 * `inset` in front of it.
 */
function wallQuad(
  wall: RoomWall,
  room: RoomInterior['room'],
  rect: { along: number; width: number; bottom: number; height: number },
  inset: number,
  hex: string,
): BufferGeometry {
  const quad = new PlaneGeometry(rect.width, rect.height)
  const y = rect.bottom + rect.height / 2
  switch (wall) {
    case 'back':
      quad.translate(rect.along, y, -room.depthM / 2 + inset)
      break
    case 'left':
      // A plane faces +z; a quarter turn faces it +x, into the room.
      quad.rotateY(Math.PI / 2)
      quad.translate(-room.widthM / 2 + inset, y, rect.along)
      break
    case 'right':
      quad.rotateY(-Math.PI / 2)
      quad.translate(room.widthM / 2 - inset, y, rect.along)
      break
  }
  return paintedPart(quad, hex)
}

/** A box standing out from a wall's inner face: `depth` into the room from `inset`. */
function wallBox(
  wall: RoomWall,
  room: RoomInterior['room'],
  rect: { along: number; width: number; bottom: number; height: number },
  inset: number,
  depth: number,
  hex: string,
): BufferGeometry {
  const y = rect.bottom + rect.height / 2
  const into = inset + depth / 2
  switch (wall) {
    case 'back':
      return paintedPart(
        boxAt([rect.width, rect.height, depth], [rect.along, y, -room.depthM / 2 + into]),
        hex,
      )
    case 'left':
      return paintedPart(
        boxAt([depth, rect.height, rect.width], [-room.widthM / 2 + into, y, rect.along]),
        hex,
      )
    case 'right':
      return paintedPart(
        boxAt([depth, rect.height, rect.width], [room.widthM / 2 - into, y, rect.along]),
        hex,
      )
  }
}

function wallLength(wall: RoomWall, room: RoomInterior['room']): number {
  return wall === 'back' ? room.widthM : room.depthM
}

/**
 * The wall itself as boxes around its openings: full-height spans between them, and the pieces
 * under each window's sill and over each opening's head. The side walls run to the open front;
 * the back wall spans the corners.
 */
function wallBody(
  wall: RoomWall,
  room: RoomInterior['room'],
  openings: readonly RoomOpening[],
  thickness: number,
  paint: string,
  cap: string,
): BufferGeometry[] {
  const length = wallLength(wall, room)
  const half = length / 2
  const extra = wall === 'back' ? thickness : 0
  const along = (from: number, to: number, bottom: number, top: number) => {
    if (to - from < 1e-4 || top - bottom < 1e-4) return null
    const mid = (from + to) / 2
    const span = to - from
    const y0 = bottom
    const y1 = top
    let piece: BufferGeometry
    switch (wall) {
      case 'back':
        piece = slab(
          [mid - span / 2, y0, -room.depthM / 2 - thickness],
          [mid + span / 2, y1, -room.depthM / 2],
          paint,
        )
        break
      case 'left':
        piece = slab(
          [-room.widthM / 2 - thickness, y0, mid - span / 2],
          [-room.widthM / 2, y1, mid + span / 2],
          paint,
        )
        break
      case 'right':
        piece = slab(
          [room.widthM / 2, y0, mid - span / 2],
          [room.widthM / 2 + thickness, y1, mid + span / 2],
          paint,
        )
        break
    }
    return capFaces(piece, cap, wall !== 'back')
  }
  const sorted = openings
    .filter((opening) => opening.wall === wall)
    .sort((a, b) => a.centerM - b.centerM)
  const parts: BufferGeometry[] = []
  let cursor = -half - extra
  for (const opening of sorted) {
    const from = opening.centerM - opening.widthM / 2
    const to = opening.centerM + opening.widthM / 2
    parts.push(
      ...[
        along(cursor, from, 0, room.heightM),
        along(from, to, 0, opening.sillM),
        along(from, to, opening.sillM + opening.heightM, room.heightM),
      ].filter((piece): piece is BufferGeometry => piece !== null),
    )
    cursor = to
  }
  const last = along(cursor, half + extra, 0, room.heightM)
  if (last !== null) parts.push(last)
  return parts
}

/** Bricks in running bond over a wall's inner face (the loft's accent wall), around its openings. */
function brickFace(
  wall: RoomWall,
  room: RoomInterior['room'],
  openings: readonly RoomOpening[],
  look: FinishLook,
  inset: number,
): BufferGeometry[] {
  const [brick, mortar] = look.colors
  const length = wallLength(wall, room)
  // The joints are the wall body behind the bricks, painted the mortar colour (buildRoomGeometry).
  const parts: BufferGeometry[] = []
  const course = 0.16
  const width = 0.42
  const holes = openings.filter((opening) => opening.wall === wall)
  const inHole = (along: number, y: number) =>
    holes.some(
      (opening) =>
        Math.abs(along - opening.centerM) < opening.widthM / 2 + width / 2 &&
        y > opening.sillM - course &&
        y < opening.sillM + opening.heightM + course,
    )
  for (let y = 0, row = 0; y < room.heightM - 1e-6; y += course, row++) {
    const height = Math.min(course, room.heightM - y) - 0.02
    for (let x = -length / 2 - (row % 2) * (width / 2); x < length / 2; x += width) {
      const x0 = Math.max(-length / 2, x + 0.01)
      const x1 = Math.min(length / 2, x + width - 0.01)
      if (x1 - x0 < 0.05 || inHole((x0 + x1) / 2, y + height / 2)) continue
      parts.push(
        wallQuad(
          wall,
          room,
          { along: (x0 + x1) / 2, width: x1 - x0, bottom: y + 0.01, height },
          inset,
          (row * 7 + Math.round(x * 10)) % 5 === 0 ? mortar : brick,
        ),
      )
    }
  }
  return parts
}

/** A window: frame, cross bars, sill and pane, with curtains either side. */
function windowParts(
  opening: RoomOpening,
  room: RoomInterior['room'],
  config: ApartmentConfig,
  colors: RoomColors,
): BufferGeometry[] {
  const inset = config.insetM
  const frame = 0.06
  const { centerM: along, widthM: width, sillM: bottom, heightM: height } = opening
  const box = (
    rect: { along: number; width: number; bottom: number; height: number },
    d: number,
    hex: string,
  ) => wallBox(opening.wall, room, rect, inset, d, hex)
  return [
    wallQuad(
      opening.wall,
      room,
      { along, width, bottom, height },
      -config.wallThicknessM / 2,
      colors.window,
    ),
    box(
      { along, width: width + frame * 2, bottom: bottom - frame, height: frame },
      0.12,
      colors.trim,
    ),
    box(
      { along, width: width + frame * 2, bottom: bottom + height, height: frame },
      0.05,
      colors.trim,
    ),
    box({ along: along - width / 2 - frame / 2, width: frame, bottom, height }, 0.05, colors.trim),
    box({ along: along + width / 2 + frame / 2, width: frame, bottom, height }, 0.05, colors.trim),
    box({ along, width: frame * 0.6, bottom, height }, 0.03, colors.trim),
    box(
      { along, width, bottom: bottom + height / 2 - frame * 0.3, height: frame * 0.6 },
      0.03,
      colors.trim,
    ),
    box(
      { along: along - width / 2 - 0.16, width: 0.22, bottom: bottom - 0.25, height: height + 0.4 },
      0.08,
      colors.curtain,
    ),
    box(
      { along: along + width / 2 + 0.16, width: 0.22, bottom: bottom - 0.25, height: height + 0.4 },
      0.08,
      colors.curtain,
    ),
  ]
}

/** A door in its frame, with a handle. */
function doorParts(
  opening: RoomOpening,
  room: RoomInterior['room'],
  config: ApartmentConfig,
  colors: RoomColors,
): BufferGeometry[] {
  const inset = config.insetM
  const frame = 0.07
  const { centerM: along, widthM: width, heightM: height } = opening
  const box = (
    rect: { along: number; width: number; bottom: number; height: number },
    d: number,
    hex: string,
  ) => wallBox(opening.wall, room, rect, inset, d, hex)
  const handleAlong = along + width * 0.35
  return [
    box({ along, width, bottom: 0, height }, 0.04, colors.furniture),
    box(
      { along: along - width / 2 - frame / 2, width: frame, bottom: 0, height: height + frame },
      0.06,
      colors.trim,
    ),
    box(
      { along: along + width / 2 + frame / 2, width: frame, bottom: 0, height: height + frame },
      0.06,
      colors.trim,
    ),
    box({ along, width: width + frame * 2, bottom: height, height: frame }, 0.06, colors.trim),
    box({ along: handleAlong, width: 0.05, bottom: 1.0, height: 0.05 }, 0.1, colors.countertop),
  ]
}

/** A counter cabinet with its worktop and a little backsplash, against the wall behind its cell. */
function counterParts(
  interior: RoomInterior,
  slotId: string,
  colors: RoomColors,
): BufferGeometry[] {
  const slot = parseSlot(slotId, interior.grid)
  if (slot?.kind !== 'floor') return []
  const [x, z] = cellCenter(interior, slot.c, slot.r)
  const cell = interior.grid.cellM
  const depth = cell * 0.62
  const back = z - cell / 2
  return [
    slab([x - cell / 2 + 0.01, 0, back], [x + cell / 2 - 0.01, 0.86, back + depth], colors.counter),
    slab([x - cell / 2, 0.86, back], [x + cell / 2, 0.92, back + depth + 0.03], colors.countertop),
    slab([x - cell / 2, 0.92, back], [x + cell / 2, 1.06, back + 0.03], colors.countertop),
    slab([x - 0.2, 0.3, back + depth], [x + 0.2, 0.33, back + depth + 0.02], colors.countertop),
  ]
}

/**
 * The shell's sections, in the order its geometry holds them: each wall with everything on it
 * (paint, brick, trim, openings), and the base (slab, floor, counters). The order keeps every
 * set of walls the orbit hides (`hiddenWalls`: one wall, or the back with one side) a cut that
 * leaves at most two contiguous ranges, so the shell never costs more than two draw calls.
 */
export const ROOM_SECTIONS = ['back', 'left', 'base', 'right'] as const
export type RoomSection = (typeof ROOM_SECTIONS)[number]

/**
 * The room shell as one vertex-coloured geometry, with `finishes` on its walls and floor: one
 * material group per section (ROOM_SECTIONS order, every group material 0).
 */
export function buildRoomGeometry(
  interior: RoomInterior,
  config: ApartmentConfig,
  colors: RoomColors,
  finishes: ShellFinishes,
): BufferGeometry {
  const { room, openings, shell } = interior
  const inset = config.insetM
  const thickness = config.wallThicknessM
  const walls: readonly RoomWall[] = ['back', 'left', 'right']
  const paint = finishLook(finishes.wall)
  const floor = finishLook(finishes.floor)
  const accent = shell.accentBack === null ? null : finishLook(shell.accentBack)
  const paintHex = paint.colors[0]
  const sections: Record<RoomSection, BufferGeometry[]> = {
    back: [],
    left: [],
    base: [],
    right: [],
  }
  sections.base.push(
    slab(
      [-room.widthM / 2 - thickness, -config.floorThicknessM, -room.depthM / 2 - thickness],
      [room.widthM / 2 + thickness, 0, room.depthM / 2],
      colors.cap,
    ),
    ...floorFinishParts(floor, room, 0.002),
  )
  for (const wall of walls) {
    const parts = sections[wall]
    // A painted brick finish covers every wall; the loft's accent shows brick on the back wall only.
    const brick = paint.pattern === 'brick' ? paint : wall === 'back' ? accent : null
    // A brick wall's body shows through the joints, so it takes the mortar colour.
    const body = brick === null ? paintHex : brick.colors[1]
    parts.push(...wallBody(wall, room, openings, thickness, body, colors.cap))
    if (brick !== null) parts.push(...brickFace(wall, room, openings, brick, inset))
    const length = wallLength(wall, room)
    parts.push(
      wallBox(
        wall,
        room,
        { along: 0, width: length, bottom: 0, height: config.trimHeightM },
        0,
        0.02,
        colors.trim,
      ),
    )
    if (shell.crown) {
      parts.push(
        wallBox(
          wall,
          room,
          {
            along: 0,
            width: length,
            bottom: room.heightM - config.crownHeightM,
            height: config.crownHeightM,
          },
          0,
          0.05,
          colors.trim,
        ),
      )
    }
  }
  for (const opening of openings) {
    sections[opening.wall].push(
      ...(opening.kind === 'window'
        ? windowParts(opening, room, config, colors)
        : doorParts(opening, room, config, colors)),
    )
  }
  for (const fixture of interior.fixtures) {
    if (fixture.kind === 'counter') {
      sections.base.push(...counterParts(interior, fixture.slotId, colors))
    }
  }
  const merged = mergeParts(
    ROOM_SECTIONS.map((section) => mergeParts(sections[section], `room ${section}`)),
    'room',
    true,
  )
  for (const group of merged.groups) group.materialIndex = 0
  return merged
}

/**
 * The shell's draw ranges (geometry groups, material 0) with the `hidden` walls left out:
 * `sections` are the shell's groups in ROOM_SECTIONS order; neighbouring shown sections join.
 */
export function shownRanges(
  sections: readonly { readonly start: number; readonly count: number }[],
  hidden: ReadonlySet<RoomWall>,
): { start: number; count: number; materialIndex: number }[] {
  const ranges: { start: number; count: number; materialIndex: number }[] = []
  ROOM_SECTIONS.forEach((section, i) => {
    const range = sections[i]
    if (range === undefined || (section !== 'base' && hidden.has(section))) return
    const last = ranges.at(-1)
    if (last !== undefined && last.start + last.count === range.start) last.count += range.count
    else ranges.push({ start: range.start, count: range.count, materialIndex: 0 })
  })
  return ranges
}

/**
 * The walls that stand between a camera at (x, z) (room metres) and the room: a wall whose outer
 * face the camera can see. The orbit hides them, like a doll's house turned round.
 */
export function hiddenWalls(
  room: RoomInterior['room'],
  x: number,
  z: number,
): ReadonlySet<RoomWall> {
  const hidden = new Set<RoomWall>()
  if (z < -room.depthM / 2) hidden.add('back')
  if (x < -room.widthM / 2) hidden.add('left')
  if (x > room.widthM / 2) hidden.add('right')
  return hidden
}

/** The room's bounding box: floor slab to ceiling, wall to open front. */
export function roomBounds(interior: RoomInterior, config: ApartmentConfig) {
  const { room } = interior
  const t = config.wallThicknessM
  return {
    min: [-room.widthM / 2 - t, -config.floorThicknessM, -room.depthM / 2 - t] as const,
    max: [room.widthM / 2 + t, room.heightM, room.depthM / 2] as const,
  }
}
