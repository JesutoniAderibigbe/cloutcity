/**
 * S40c data: data/config/roomSim.json (how the room's Sim walks, poses and acts out each home
 * action) and data/homes/interactions.json (where each furniture model is used, each home's
 * fallback spots), checked against each other and the rest of the data: every home action has
 * steps, every pose plays a clip both rigs have, every model is one the room draws, props use
 * palette tokens, bubbles name copy that exists, and every spot is a free floor cell.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSlot } from '@/engine/homeGrid'
import { baseCopy } from '@/lib/copy/all'
import { balance } from './config'
import { homeInteriors } from './content'
import { HOME_IDS } from './homes'
import { InteractionsFileSchema, RoomSimConfigSchema } from './schemas/roomSim'

const DATA = join(import.meta.dirname, '../../../data')
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(DATA, path), 'utf8'))

const sim = RoomSimConfigSchema.parse(readJson('config/roomSim.json'))
const interactions = InteractionsFileSchema.parse(readJson('homes/interactions.json'))
const manifest = readJson('assets/manifest.json') as {
  models: { id: string; kind: string; clips: string[] }[]
}
const scene = readJson('config/scene.json') as {
  models: { decor: Record<string, { model: string }> }
}
const theme = readJson('config/theme.json') as { colors: Record<string, string> }

const rigs = manifest.models.filter((model) => model.kind === 'rig')
const drawnModels = new Set([
  ...Object.values(scene.models.decor).map((entry) => entry.model),
  ...HOME_IDS.flatMap((home) =>
    homeInteriors[home].fixtures.flatMap((fixture) =>
      fixture.kind === 'model' ? [fixture.model] : [],
    ),
  ),
])

describe('data/config/roomSim.json (S40c)', () => {
  it('acts out every home action', () => {
    for (const id of balance.place.homeActions) expect(Object.keys(sim.actions)).toContain(id)
  })

  it('poses play clips every avatar rig has, walking included', () => {
    expect(rigs.length).toBeGreaterThan(0)
    const clips = [...Object.values(sim.poses).map((pose) => pose.clip), 'walk']
    for (const rig of rigs) for (const clip of clips) expect(rig.clips).toContain(clip)
  })

  it('every step names poses, props and furniture that exist, and copy for its bubble', () => {
    for (const steps of Object.values(sim.actions)) {
      for (const step of steps) {
        for (const pose of step.poses) expect(Object.keys(sim.poses)).toContain(pose)
        for (const model of step.models) expect(drawnModels).toContain(model)
        // Each step can be done somewhere: some model offers one of its poses.
        expect(
          step.models.some((model) =>
            (interactions.models[model] ?? []).some((anchor) => step.poses.includes(anchor.pose)),
          ),
        ).toBe(true)
        if (step.prop !== undefined) expect(Object.keys(sim.props)).toContain(step.prop)
        if (step.bubble !== undefined) expect(Object.keys(baseCopy.strings)).toContain(step.bubble)
      }
    }
    for (const pose of sim.fallback.poses) expect(Object.keys(sim.poses)).toContain(pose)
  })

  it('props are painted with palette tokens', () => {
    for (const prop of Object.values(sim.props)) {
      for (const part of prop.parts) expect(Object.keys(theme.colors)).toContain(part.token)
    }
  })
})

describe('data/homes/interactions.json (S40c)', () => {
  it('anchors furniture the room draws, in poses that exist', () => {
    for (const [model, anchors] of Object.entries(interactions.models)) {
      expect(drawnModels).toContain(model)
      for (const anchor of anchors) expect(Object.keys(sim.poses)).toContain(anchor.pose)
    }
    for (const model of interactions.walkable) expect(drawnModels).toContain(model)
  })

  it("puts every home's fallback spots on free floor cells of its grid", () => {
    for (const home of HOME_IDS) {
      const { grid } = homeInteriors[home]
      const fixtures = new Set(homeInteriors[home].fixtures.map((fixture) => fixture.slot))
      for (const spot of interactions.homes[home].spots) {
        expect(parseSlot(spot.slot, grid)?.kind, `${home} ${spot.slot}`).toBe('floor')
        expect(fixtures.has(spot.slot), `${home} ${spot.slot}`).toBe(false)
        expect(Object.keys(sim.poses)).toContain(spot.pose)
      }
    }
  })
})
