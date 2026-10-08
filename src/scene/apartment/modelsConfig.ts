/**
 * scene.json `models` for the apartment's lazy chunks (the decor models and the room avatar),
 * which read scene.json themselves: the city's props never reach them.
 */
import sceneJson from '@data/config/scene.json'
import type { SceneConfig } from '@/lib/data/schemas/scene'

type ModelsConfig = SceneConfig['models']

function fail(what: string): never {
  throw new Error(`apartment models config: ${what}`)
}

/**
 * scene.json `models`, narrowed from the loosely typed JSON import (the file itself is checked
 * against its zod schema in src/lib/data/data.test.ts; classic zod must not ship here).
 */
export function modelsConfig(): ModelsConfig {
  const raw = sceneJson.models
  const material = (value: string) =>
    value === 'lambert' || value === 'standard' ? value : fail(`litMaterial ${value}`)
  const shading = raw.shading === 'lit' || raw.shading === 'toon' ? raw.shading : fail('shading')
  return {
    ...raw,
    shading,
    litMaterial: {
      low: material(raw.litMaterial.low),
      mid: material(raw.litMaterial.mid),
      high: material(raw.litMaterial.high),
    },
    player: {
      ...raw.player,
      capsuleTiers: raw.player.capsuleTiers.map((tier) =>
        tier === 'low' || tier === 'mid' || tier === 'high' ? tier : fail(`capsule tier ${tier}`),
      ),
    },
  }
}
