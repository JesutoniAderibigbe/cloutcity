/**
 * What the engine reads about homes on the playable path (S40, PERF-6): each home's grid, the
 * cells nothing may take (fixtures; windows and the door on the walls), the floor cells kept
 * walkable (the avatar's spot, the way in from the door), its starter pieces and original
 * finishes, and every finish's id, kind, price and name. Derived from data/homes/interiors.json
 * and data/homes/finishes.json into data/homes/engine.derived.json (`npm run homes:update`), so
 * the store's chunks carry these few fields instead of the room's camera, openings and colours
 * (src/lib/data/homes-derived.test.ts keeps the file current).
 */
import { floorSlotId, parseSlot, wallSlotId, type GridWall } from '@/engine/homeGrid'
import type { Finish, HomeInterior } from './schemas/content'

export interface HomeEngineTable {
  readonly cols: number
  readonly rows: number
  readonly cellM: number
  readonly blocked: readonly string[]
  readonly walkway: readonly string[]
  readonly starter: readonly {
    readonly itemId: string
    readonly slot: string
    readonly turn: number
  }[]
  readonly wallPaint: string
  readonly floorFinish: string
}

export interface HomeEngineTables {
  readonly homes: Readonly<Record<string, HomeEngineTable>>
  readonly finishes: readonly Pick<Finish, 'id' | 'kind' | 'price' | 'nameKey'>[]
}

/** The floor cell inside the room next to a door on `wall` at wall cell `at`. */
function doorway(wall: GridWall, at: number, cols: number): string {
  switch (wall) {
    case 'back':
      return floorSlotId(at, 0)
    case 'left':
      return floorSlotId(0, at)
    case 'right':
      return floorSlotId(cols - 1, at)
  }
}

function table(id: string, home: HomeInterior): HomeEngineTable {
  const { cols, rows, cellM } = home.grid
  const size = { cols, rows }
  const cell = (slotId: string, what: string) => {
    if (parseSlot(slotId, size) === null)
      throw new Error(`${id}: ${what} "${slotId}" is off the grid`)
    return slotId
  }
  const blocked = new Set<string>()
  const walkway = new Set<string>([cell(home.avatar.slot, 'avatar')])
  for (const opening of home.openings) {
    for (let i = opening.at; i < opening.at + opening.span; i++) {
      blocked.add(cell(wallSlotId(opening.wall, i), 'opening'))
    }
    if (opening.kind === 'door')
      walkway.add(cell(doorway(opening.wall, opening.at, cols), 'doorway'))
  }
  for (const fixture of home.fixtures) blocked.add(cell(fixture.slot, 'fixture'))
  return {
    cols,
    rows,
    cellM,
    blocked: [...blocked],
    walkway: [...walkway],
    starter: home.starter.map((entry) => ({
      itemId: entry.itemId,
      slot: cell(entry.slot, entry.itemId),
      turn: entry.turn,
    })),
    wallPaint: home.shell.wallPaint,
    floorFinish: home.shell.floorFinish,
  }
}

export function deriveHomeEngineTables(input: {
  readonly interiors: Readonly<Record<string, HomeInterior>>
  readonly finishes: readonly Finish[]
}): HomeEngineTables {
  return {
    homes: Object.fromEntries(
      Object.entries(input.interiors).map(([id, home]) => [id, table(id, home)]),
    ),
    finishes: input.finishes.map(({ id, kind, price, nameKey }) => ({ id, kind, price, nameKey })),
  }
}
