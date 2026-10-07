/**
 * The shared material every hand-made model draws with (S04h, DEC-26). Colour comes from the
 * baked vertex colours, so one material serves every static model, instanced or not, and every
 * skinned avatar part (three r182 picks the skinning program variant per object). Shading is
 * scene.json `models.shading`: `lit` uses MeshStandardMaterial or the cheaper Lambert per tier
 * (`litMaterial`), `toon` the city's shared toon ramp.
 */
import {
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  type DataTexture,
  type Material,
} from 'three'
import type { ModelsConfig, ModelTier } from './types'

export interface ModelMaterialOptions {
  readonly config: ModelsConfig
  readonly tier: ModelTier
  /** The city's toon ramp (materials.ts createToonRamp), used when shading is `toon`. */
  readonly gradientMap?: DataTexture
}

export function createModelMaterial({ config, tier, gradientMap }: ModelMaterialOptions): Material {
  if (config.shading === 'toon') {
    if (gradientMap === undefined) throw new Error('Toon model shading needs the toon ramp')
    return new MeshToonMaterial({ vertexColors: true, gradientMap })
  }
  if (config.litMaterial[tier] === 'lambert') return new MeshLambertMaterial({ vertexColors: true })
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: config.roughness,
    metalness: config.metalness,
  })
}
