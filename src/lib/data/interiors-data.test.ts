/**
 * S43 data: data/interiors/venues/<id>.json (each venue interior's layout, pieces, lights, crowd
 * and the Sim's actions), data/interiors/sim.json (the Sim's venue poses and props),
 * data/interiors/types.json (which venue types and venues open an interior) and
 * data/config/interiors.json (per-tier caps and crowd), checked against each other and the rest
 * of the data: every venue type with an interior exists and every action its sheet offers is
 * acted out, finishes, palette tokens, catalog items, models and copy exist, and every cell, spot
 * and pose is inside the room and drawable.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSlot } from '@/engine/homeGrid'
import { baseCopy } from '@/lib/copy/all'
import { balance } from './config'
import { items, venues } from './content'
import {
  InteriorSchema,
  InteriorSimFileSchema,
  InteriorTypesFileSchema,
  InteriorsConfigSchema,
  type InteriorData,
} from './schemas/interiors'
import { RoomSimConfigSchema } from './schemas/roomSim'
import { QUALITY_TIERS } from './schemas/config'

const DATA = join(import.meta.dirname, '../../../data')
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(DATA, path), 'utf8'))

const file = {
  sim: InteriorSimFileSchema.parse(readJson('interiors/sim.json')).sim,
  interiors: Object.fromEntries(
    readdirSync(join(DATA, 'interiors/venues'))
      .filter((name) => name.endsWith('.json'))
      .map((name): [string, InteriorData] => [
        name.replace(/\.json$/, ''),
        InteriorSchema.parse(readJson(`interiors/venues/${name}`)),
      ]),
  ) as Record<string, InteriorData | undefined>,
}
const types = InteriorTypesFileSchema.parse(readJson('interiors/types.json'))
const config = InteriorsConfigSchema.parse(readJson('config/interiors.json'))
const roomSim = RoomSimConfigSchema.parse(readJson('config/roomSim.json'))
const finishes = (readJson('homes/finishes.json') as { finishes: { id: string; kind: string }[] })
  .finishes
const theme = readJson('config/theme.json') as Record<string, Record<string, string>>
const scene = readJson('config/scene.json') as {
  models: { decor: Record<string, { model: string }> }
}
const manifest = readJson('assets/manifest.json') as {
  models: { id: string; kind: string; clips: string[] }[]
}
const interactions = readJson('homes/interactions.json') as { models: Record<string, unknown> }
const homeInteriors = readJson('homes/interiors.json') as {
  homes: Record<string, { fixtures: { model?: string }[] }>
}
/** Models a room scene loads (src/scene/apartment/decorModels.ts): decor items' and fixtures'. */
const roomModels = new Set([
  ...Object.values(scene.models.decor).map((entry) => entry.model),
  ...Object.values(homeInteriors.homes).flatMap((home) =>
    home.fixtures.flatMap((fixture) => (fixture.model === undefined ? [] : [fixture.model])),
  ),
])

const tokens = new Set([
  ...Object.keys(theme.colors ?? {}),
  ...Object.keys(theme.world ?? {}),
  ...Object.keys(theme.models ?? {}),
])
const rigs = manifest.models.filter((model) => model.kind === 'rig')
const interiors = Object.entries(file.interiors).flatMap(([id, interior]) =>
  interior === undefined ? [] : [[id, interior] as const],
)

/** Every action a venue's sheet can offer: its type's, a shift per job, the club night, flex. */
function sheetActions(venue: { type: string; jobIds?: readonly string[] }): string[] {
  const offered = [...(balance.place.venueActions[venue.type] ?? []), 'flex']
  for (const job of venue.jobIds ?? []) offered.push(`shift-${job}`)
  if (venue.type === 'club') offered.push('club-night')
  return offered
}

/** Every palette token a value names, wherever it sits. */
function tokensIn(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    return /token$/i.test(key) || key === 'dim' || key === 'tint' ? [value] : []
  }
  if (Array.isArray(value)) {
    return key === 'tokens'
      ? value.filter((entry) => typeof entry === 'string')
      : value.flatMap((entry) => tokensIn(entry, key))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => tokensIn(v, k))
  }
  return []
}

describe('data/interiors/types.json (S43)', () => {
  it('maps venue types and venues that exist to interiors that exist', () => {
    const venueTypes = new Set(venues.map((venue) => venue.type))
    for (const [type, interior] of Object.entries(types.byVenueType)) {
      expect(venueTypes).toContain(type)
      expect(Object.keys(file.interiors)).toContain(interior)
    }
    for (const [venueId, interior] of Object.entries(types.byVenue)) {
      expect(venues.map((venue) => venue.id)).toContain(venueId)
      expect(Object.keys(file.interiors)).toContain(interior)
    }
  })

  it('opens the club and the lounge first', () => {
    expect(types.byVenueType.club).toBe('club')
    expect(types.byVenueType.lounge).toBe('lounge')
  })
})

describe('data/interiors/venues (S43)', () => {
  it('acts out every action the sheet offers at each venue with an inside view', () => {
    for (const venue of venues) {
      const id = types.byVenue[venue.id] ?? types.byVenueType[venue.type]
      if (id === undefined) continue
      const actions = Object.keys(file.interiors[id]?.actions ?? {})
      for (const action of sheetActions(venue)) expect(actions, `${venue.id}`).toContain(action)
    }
  })

  it('poses play clips every avatar rig has, and steps name poses and props that exist', () => {
    const poses = { ...roomSim.poses, ...file.sim.poses }
    for (const rig of rigs) {
      for (const pose of Object.values(file.sim.poses)) expect(rig.clips).toContain(pose.clip)
      expect(rig.clips).toContain(file.sim.groove.clip)
    }
    for (const [, interior] of interiors) {
      for (const steps of Object.values(interior.actions)) {
        for (const step of steps) {
          for (const pose of step.poses) expect(Object.keys(poses)).toContain(pose)
          if (step.prop !== undefined) {
            expect([...Object.keys(roomSim.props), ...Object.keys(file.sim.props)]).toContain(
              step.prop,
            )
          }
          if (step.bubble !== undefined)
            expect(Object.keys(baseCopy.strings)).toContain(step.bubble)
          // A step without furniture needs a spot for one of its poses.
          if (step.models.length === 0) {
            expect(interior.simSpots.some((spot) => step.poses.includes(spot.pose))).toBe(true)
          }
        }
      }
    }
  })

  it('uses finishes, palette tokens, catalog items and models that exist', () => {
    const finishIds = new Map(finishes.map((finish) => [finish.id, finish.kind]))
    for (const [, interior] of interiors) {
      expect(finishIds.get(interior.shell.wallPaint)).toBe('wall')
      expect(finishIds.get(interior.shell.floorFinish)).toBe('floor')
      for (const token of tokensIn(interior)) expect(tokens).toContain(token)
      for (const decor of interior.decor) {
        const item = items.find((candidate) => candidate.id === decor.item)
        expect(item?.decor?.footprint ?? '1x1').toBe(decor.footprint)
        expect(item?.decor?.fits).toBe('floor')
        expect(Object.keys(scene.models.decor)).toContain(decor.item)
        expect(theme.colors).toHaveProperty(decor.token)
      }
      // Only models a room scene loads, else the fixture stays a stand-in box.
      for (const fixture of interior.fixtures) expect(roomModels).toContain(fixture.model)
      for (const piece of interior.pieces) expect(Object.keys(interior.kinds)).toContain(piece.kind)
    }
    for (const prop of Object.values(file.sim.props)) {
      for (const part of prop.parts) expect(theme.colors).toHaveProperty(part.token)
    }
  })

  it('keeps every cell, spot and light inside the room', () => {
    for (const [, interior] of interiors) {
      const { cols, rows, cellM } = interior.grid
      const halfW = (cols * cellM) / 2
      const halfD = (rows * cellM) / 2
      const cells = [
        interior.entry.slot,
        ...interior.decor.map((decor) => decor.slot),
        ...interior.fixtures.map((fixture) => fixture.slot),
        ...interior.pieces.map((piece) => piece.slot),
        ...interior.blocked,
        ...interior.simSpots.map((spot) => spot.slot),
      ]
      for (const cell of cells) expect(parseSlot(cell, { cols, rows })?.kind).toBe('floor')
      for (const spot of interior.crowd.spots) {
        expect(Math.abs(spot.at[0])).toBeLessThan(halfW)
        expect(Math.abs(spot.at[1])).toBeLessThan(halfD)
      }
      // The Sim's spots and its door spot stand on floor it can reach.
      const blocked = new Set(interior.blocked)
      for (const spot of [interior.entry, ...interior.simSpots]) {
        expect(blocked.has(spot.slot)).toBe(false)
      }
      if (interior.danceFloor !== null) {
        const floor = parseSlot(interior.danceFloor.slot, { cols, rows })
        expect(floor?.kind).toBe('floor')
        if (floor?.kind === 'floor') {
          expect(floor.c + interior.danceFloor.cols).toBeLessThanOrEqual(cols)
          expect(floor.r + interior.danceFloor.rows).toBeLessThanOrEqual(rows)
        }
      }
    }
  })

  it('seats locals on furniture with sit anchors, in poses the crowd draws', () => {
    for (const [, interior] of interiors) {
      for (const seat of interior.crowd.seats) {
        const model = seat.kind ?? seat.model ?? ''
        const anchored =
          seat.kind !== undefined
            ? (interior.kinds[seat.kind]?.anchors ?? []).some((anchor) => anchor.pose === 'sit')
            : Object.keys(interactions.models).includes(model)
        expect(anchored).toBe(true)
      }
      for (const pose of interior.crowd.poses) {
        expect(Object.keys(config.crowd.clips)).toContain(pose)
      }
      for (const spot of interior.crowd.spots) expect(interior.crowd.poses).toContain(spot.pose)
      if (interior.crowd.seats.length > 0) expect(interior.crowd.poses).toContain('sit')
      // A staff member is in whenever the venue is open.
      expect(interior.crowd.spots.some((spot) => spot.staff === true)).toBe(true)
    }
  })

  it('draws the staff on every tier (their pose, or a standing stand-in, in its first clips)', () => {
    for (const [id, interior] of interiors) {
      for (const tier of QUALITY_TIERS) {
        const clips = new Set<string>()
        const drawn = new Set<string>()
        for (const pose of interior.crowd.poses) {
          const clip = config.crowd.clips[pose] ?? ''
          if (!clips.has(clip) && clips.size >= config.crowd.clipsMax[tier]) continue
          clips.add(clip)
          drawn.add(pose)
        }
        for (const spot of interior.crowd.spots.filter((entry) => entry.staff === true)) {
          const shown =
            drawn.has(spot.pose) ||
            (spot.pose !== 'dance' && (drawn.has('talk') || drawn.has('idle')))
          expect(shown, `${id} ${tier} ${spot.activity}`).toBe(true)
        }
      }
    }
  })

  it('is open some hours and busiest at a full crowd', () => {
    for (const [, interior] of interiors) {
      const shares = interior.crowd.hours.map(([, share]) => share)
      expect(Math.max(...shares)).toBe(1)
      expect(new Set(interior.crowd.hours.map(([hour]) => hour)).size).toBe(shares.length)
      for (const day of interior.crowd.busyDays) {
        expect(day).toBeLessThanOrEqual(balance.time.rentPeriodGameDays)
      }
    }
  })
})

describe('data/config/interiors.json (S43)', () => {
  it('draws 6 to 14 locals at a full hour, more on higher tiers', () => {
    expect(config.crowd.max.low).toBe(6)
    expect(config.crowd.max.high).toBe(14)
    expect(config.crowd.max.mid).toBeGreaterThanOrEqual(config.crowd.max.low)
    expect(config.crowd.max.high).toBeGreaterThanOrEqual(config.crowd.max.mid)
  })

  it('caps grow with the tier, and every pose plays a clip every rig has', () => {
    for (const caps of [
      config.caps.drawCallsMax,
      config.caps.trianglesMax,
      config.crowd.clipsMax,
    ]) {
      expect(caps.mid).toBeGreaterThanOrEqual(caps.low)
      expect(caps.high).toBeGreaterThanOrEqual(caps.mid)
    }
    for (const clip of Object.values(config.crowd.clips)) {
      for (const rig of rigs) expect(rig.clips).toContain(clip)
    }
    for (const pose of Object.keys(config.crowd.moves)) {
      expect(Object.keys(config.crowd.clips)).toContain(pose)
    }
  })

  it('leaves room on every tier for the locals it draws (four calls per body and clip)', () => {
    for (const tier of QUALITY_TIERS) {
      expect(config.crowd.bodies[tier] * config.crowd.clipsMax[tier] * 4).toBeLessThan(
        config.caps.drawCallsMax[tier],
      )
    }
  })
})
