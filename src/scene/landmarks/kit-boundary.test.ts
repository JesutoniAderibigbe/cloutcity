/**
 * The landmark kit is code-built geometry on three alone: no React, no config loaders, no model
 * loaders. The only model files in public/ are our Blender-built landmark GLBs (DEC-25, S07c),
 * each pinned by its lock; never downloaded models.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = import.meta.dirname
const ROOT = join(DIR, '../../..')
const sources = readdirSync(DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name))
  .filter((entry) => !/\.(test|fixture)\.ts$/.test(entry.name))
  .map((entry) => relative(DIR, join(entry.parentPath, entry.name)))
  .sort()

const specifiers = (code: string) =>
  [...code.matchAll(/^\s*(?:import|export)\s[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map(
    (match) => match[1] ?? '',
  )

/** What kit modules may import. Schema and config imports must be type-only. */
const ALLOWED = [
  /^three$/,
  /^three\/addons\/utils\/BufferGeometryUtils\.js$/,
  /^\.\.?\//,
  /^@\/lib\/landmarks\/metrics$/,
  /^@\/lib\/data\/schemas\/(?:landmarkModels|config)$/,
]

describe('src/scene/landmarks', () => {
  it('finds the kit modules', () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        'buildLandmark.ts',
        'materials.ts',
        'kit/primitives.ts',
        'kit/compose.ts',
        'kit/outline.ts',
        'archetypes/civicHall.ts',
        'archetypes/cantileverBridge.ts',
      ]),
    )
  })

  it.each(sources)('%s imports only three, BufferGeometryUtils and the kit', (file) => {
    const code = readFileSync(join(DIR, file), 'utf8')
    const specs = specifiers(code)
    expect(specs.filter((spec) => !ALLOWED.some((pattern) => pattern.test(spec)))).toEqual([])
    expect(code).not.toMatch(/\bimport\s*\(/)
    expect(code).not.toMatch(/Loader\b|\/loaders\/|\.(?:glb|gltf|obj|fbx|stl|ply|dae|usdz)\b/i)
    expect(code).not.toMatch(/from ['"]react|from ['"]@react-three/)
    // Schemas and config are read as types only; their loaders never reach the scene chunk.
    for (const match of code.matchAll(
      /^import\s+(type\s+)?[^'"]*?from\s+['"]@\/lib\/data\/schemas\/[^'"]+['"]/gm,
    )) {
      expect(match[1], `${file}: ${match[0]}`).toBe('type ')
    }
  })

  it('public/ ships no 3D model files but the Blender-built landmark GLBs (S07c)', () => {
    const models = readdirSync(join(ROOT, 'public'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split('\\').join('/'))
      .filter((name) => /\.(?:glb|gltf|obj|fbx|stl|ply|dae|3ds|usdz|drc|ktx2)$/i.test(name))
    // Our own models, built by scripts/blender and pinned by a lock in data/landmarks/blender.
    const ours = /^public\/models\/landmarks\/([a-z0-9-]+)\/lod[0-3]\.glb$/
    for (const model of models) {
      const id = ours.exec(model)?.[1]
      expect(id, model).toBeDefined()
      const lock = readFileSync(join(ROOT, 'data/landmarks/blender', `${id}.lock.json`), 'utf8')
      expect(lock).toContain(`"${model}"`)
    }
  })
})
