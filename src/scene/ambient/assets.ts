/**
 * What the page carries for the living city of one tier (S04l): where the streets are and the GLB
 * of every model its kits bake. Resolved on the server (src/lib/data/districts.ts
 * `ambientAssets`), kept small because it rides in the page's payload for every tier. The lazy
 * ambient chunk reads data/config/ambient.json and perf.json `ambient` itself.
 */
import type { ModelRef } from '../models/types'

/** One model a kit is baked from: its catalog id, kind, slots and the tier's served file. */
export interface AmbientModelAsset extends Pick<ModelRef, 'id' | 'kind' | 'slots'> {
  readonly file: string
}

export interface AmbientAssets {
  /** /geo/streets?v=<hash> (shared with the street props). */
  readonly streetsUrl: string
  /** ambient.json `vehicles.models[tier]`, in order. */
  readonly vehicles: readonly AmbientModelAsset[]
  /** What the tier's pedestrian source loads (pedestrianModelIds), in order. */
  readonly pedestrians: readonly AmbientModelAsset[]
}
