/**
 * The dance moves (S16c): clips keyed on the beat (scripts/blender/avatar-anim/dance.py) in
 * their own rig GLB per body frame (`avatar-dance-*`), so they cost the playable path, the city
 * and the apartment nothing: only a venue interior fetches them, for the locals on its dance
 * floor (crowdLayer.ts), the player's Sim and the real players dancing there (VenuePeople.tsx).
 *
 * Its own small module: the crowd chunk imports it, the players' chunk loads it on demand.
 */
import manifestJson from '@data/assets/manifest.json'
import interiorsConfigJson from '@data/config/interiors.json'
import type { ModelRef } from '../models/types'

function fail(what: string): never {
  throw new Error(`dance moves: ${what}`)
}

/** A manifest model as a ref the model runtime loads (a rig or a skinned part). */
export function modelRef(id: string): ModelRef {
  const entry = manifestJson.models.find((candidate) => candidate.id === id)
  if (entry === undefined) fail(`no model "${id}" in the manifest`)
  const kind = entry.kind
  if (kind !== 'rig' && kind !== 'skinned') fail(`"${id}" is not a rig or skinned model`)
  return {
    id: entry.id,
    kind,
    category: entry.category as ModelRef['category'],
    slots: entry.slots,
    emissive: entry.emissive,
    clips: entry.clips,
    files: { low: entry.tiers.low.file, mid: entry.tiers.mid.file, high: entry.tiers.high.file },
  }
}

export interface DanceMoves {
  /** The tempo the moves are keyed at: a venue plays them at its own beat (bpm / this). */
  readonly bpm: number
  /** Clip names, in the order tiers take them (a tier with n moves bakes the first n). */
  readonly moves: readonly string[]
  /** The player's Sim changes move every this many bars. */
  readonly barsPerMove: number
  /** The dance rig for a body frame's rig (null for a rig with no moves). */
  rigFor(frameRig: string): ModelRef | null
}

let cached: DanceMoves | undefined

/** data/config/interiors.json `dance`, checked against the manifest once. */
export function danceMoves(): DanceMoves {
  if (cached !== undefined) return cached
  const { bpm, moves, rigs, barsPerMove } = interiorsConfigJson.dance
  if (!(bpm > 0) || moves.length === 0 || !(barsPerMove > 0)) fail('bad config')
  const refs = new Map(
    Object.entries(rigs).map(([frameRig, danceRig]) => {
      const ref = modelRef(danceRig)
      for (const move of moves) {
        if (!ref.clips.includes(move)) fail(`"${danceRig}" has no clip "${move}"`)
      }
      return [frameRig, ref] as const
    }),
  )
  cached = { bpm, moves, barsPerMove, rigFor: (frameRig) => refs.get(frameRig) ?? null }
  return cached
}

/** A stable pick in [0, n) from an id (a real player's dance move, the same on every client). */
export function pickBy(id: string, n: number): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % Math.max(1, n)
}
