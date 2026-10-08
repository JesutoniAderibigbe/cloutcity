/**
 * What the page carries for the living city of one tier (S04l): where the streets are and the GLB
 * of every model its kits bake. Resolved on the server (src/lib/data/districts.ts
 * `ambientAssets`), kept small because it rides in the page's payload for every tier. The lazy
 * ambient chunk reads data/config/ambient.json and perf.json `ambient` itself.
 */
import type { ModelRef } from '../models/types'

/**
 * One model a kit is baked from, as a tuple to keep the payload small: catalog id, kind, the
 * tier's served file and its `_SLOT` names joined by commas.
 */
export type AmbientModelAsset = readonly [
  id: string,
  kind: ModelRef['kind'],
  file: string,
  slots: string,
]

export interface AmbientAssets {
  /** /geo/streets?v=<hash> (shared with the street props). */
  readonly streetsUrl: string
  /** ambient.json `vehicles.models[tier]`, in order. */
  readonly vehicles: readonly AmbientModelAsset[]
  /** What the tier's pedestrians and townsfolk load (characterModelIds), in order. */
  readonly pedestrians: readonly AmbientModelAsset[]
}
