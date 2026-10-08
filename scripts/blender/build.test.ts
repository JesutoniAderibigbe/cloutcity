/**
 * The Blender runner (S04h, DEC-25): committed outputs are pinned to the runner, the model script,
 * its data deps (data/avatar/frame.json, S16b) and the GLB, and pack files a script reads are
 * pinned to scripts/assets/sources.lock.json, so a changed script, a changed frame, a re-pinned
 * pack or a hand-edited GLB fails `--check` without Blender. The smoke fixture (a crate) was built
 * by Blender 5.2.2 headless and is byte-stable across runs (`--selftest` rebuilds it twice).
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BlenderLockSchema,
  checkBlenderOutputs,
  modelInputs,
  readBlenderLock,
  readPackPins,
} from './build.ts'

const ROOT = join(import.meta.dirname, '../..')
const FIXTURE_LOCK = join(ROOT, 'scripts/blender/fixtures/lock.json')

/** A scratch copy of scripts/blender to tamper with. */
async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cc-blender-'))
  await cp(join(ROOT, 'scripts/blender'), join(root, 'scripts/blender'), { recursive: true })
  return root
}

describe('blender:build', () => {
  it('pins Blender 5.2.2 and ships the avatar attachments and clips (S16a/S16b) and the S04l bus', async () => {
    const lock = await readBlenderLock()
    expect(lock.blender.version).toBe('5.2.2')
    expect(lock.outDir).toBe('scripts/blender/out')
    const vehicles = new Set(['bus-ambient'])
    const attachments = lock.models.filter(
      (model) => !model.id.startsWith('avatar-clips-') && !vehicles.has(model.id),
    )
    expect(attachments.map((model) => model.id)).toEqual([
      'hair-afro',
      'hair-locs',
      'hair-box-braids',
      'hair-cornrows',
      'hair-buzz',
      'headwear-hijab',
      'headwear-turban',
      'headwear-durag',
      'headwear-beanie',
      'headwear-ballcap',
      'facial-stubble',
      'facial-moustache',
      'facial-goatee',
      'facial-full-beard',
      'acc-gold-hoops',
      'acc-subway-tote',
      'glasses',
      'sunglasses',
      'hearing-aid',
      'scalp-cap-f',
    ])
    for (const model of attachments) {
      expect(model.script).toBe(`scripts/blender/avatar/${model.id}.py`)
      // Each attachment is modelled on the bind-pose frame the asset build derives (P2a).
      expect(model.deps).toEqual(['data/avatar/frame.json'])
      expect(model.sources).toBeUndefined()
    }
    const clips = lock.models.filter((model) => model.id.startsWith('avatar-clips-'))
    expect(clips.map((model) => [model.id, model.args])).toEqual([
      ['avatar-clips-f', ['frame=f']],
      ['avatar-clips-m', ['frame=m']],
    ])
    const pins = await readPackPins()
    for (const clip of clips) {
      expect(clip.script).toBe('scripts/blender/avatar-anim/retarget.py')
      expect(clip.sources?.map((s) => `${s.source}/${s.path}`)).toEqual([
        'quaternius-ual/quaternius-ual-standard.zip',
        clip.id.endsWith('-f')
          ? 'quaternius-modular-women/glTF/Casual.gltf'
          : 'quaternius-modular-men/glTF/Casual_Hoodie.gltf',
      ])
      for (const source of clip.sources ?? []) {
        expect(source.sha256).toBe(pins.get(`${source.source}/${source.path}`))
      }
      expect(modelInputs(clip)).toEqual([
        'data/avatar/frame.json',
        'scripts/blender/avatar-anim/retarget.py',
        'scripts/blender/run.py',
      ])
    }
    for (const model of lock.models.filter((m) => vehicles.has(m.id))) {
      expect(model.script).toBe(`scripts/blender/vehicles/${model.id}.py`)
    }
    expect(lock.models.filter((model) => vehicles.has(model.id)).map((m) => m.id)).toEqual([
      ...vehicles,
    ])
    expect(await checkBlenderOutputs(lock)).toEqual([])
  })

  it('fails when the frame a script reads changed, or a pack it reads was re-pinned', async () => {
    const lock = await readBlenderLock()
    const clip = lock.models.find((model) => model.id === 'avatar-clips-f')
    if (clip === undefined) throw new Error('no avatar-clips-f')
    const root = await scratch()
    try {
      await mkdir(join(root, 'data/avatar'), { recursive: true })
      await writeFile(join(root, 'data/avatar/frame.json'), '{}')
      const pins = await readPackPins()
      const problems = await checkBlenderOutputs({ ...lock, models: [clip] }, root, pins)
      expect(problems.join('\n')).toMatch(/frame\.json changed since the last Blender build/)
      const repinned = new Map(pins)
      repinned.set('quaternius-ual/quaternius-ual-standard.zip', '0'.repeat(64))
      const stale = await checkBlenderOutputs({ ...lock, models: [clip] }, ROOT, repinned)
      expect(stale).toEqual([
        'avatar-clips-f: quaternius-ual/quaternius-ual-standard.zip was re-pinned since the last Blender build; run npm run blender:build',
      ])
      const unpinned = await checkBlenderOutputs({ ...lock, models: [clip] }, ROOT, new Map())
      expect(unpinned[0]).toMatch(/is not in scripts\/assets\/sources\.lock\.json/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts the smoke fixture as built', async () => {
    const lock = await readBlenderLock(FIXTURE_LOCK)
    expect(lock.models.map((model) => model.id)).toEqual(['smoke-crate'])
    expect(await checkBlenderOutputs(lock)).toEqual([])
  })

  it('fails when the script, the runner or the GLB changed since the last build', async () => {
    const lock = await readBlenderLock(FIXTURE_LOCK)
    for (const [file, message] of [
      ['fixtures/smoke-crate.py', /smoke-crate\.py changed since the last Blender build/],
      ['run.py', /run\.py changed since the last Blender build/],
      ['fixtures/smoke-crate.glb', /does not match its lock sha256/],
    ] as const) {
      const root = await scratch()
      try {
        await writeFile(join(root, 'scripts/blender', file), 'tampered')
        expect((await checkBlenderOutputs(lock, root)).join('\n')).toMatch(message)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('reports a model that was never built and rejects paths outside scripts/blender', () => {
    const unbuilt = BlenderLockSchema.parse({
      version: 1,
      blender: { version: '5.2.2', executable: 'blender' },
      outDir: 'scripts/blender/out',
      models: [{ id: 'bridge', script: 'scripts/blender/models/bridge.py' }],
    })
    return checkBlenderOutputs(unbuilt).then((problems) => {
      expect(problems).toEqual(['bridge: not built yet; run npm run blender:build'])
      expect(
        BlenderLockSchema.safeParse({
          ...unbuilt,
          models: [{ id: 'x', script: 'scripts/blender/../../etc/x.py' }],
        }).success,
      ).toBe(false)
      // Data deps may only come from data/avatar/ (or scripts/blender/).
      expect(
        BlenderLockSchema.safeParse({
          ...unbuilt,
          models: [{ id: 'x', script: 'scripts/blender/x.py', deps: ['src/engine/x.ts'] }],
        }).success,
      ).toBe(false)
    })
  })

  it('--check runs without Blender; bad flags exit 1', () => {
    const check = spawnSync(process.execPath, ['scripts/blender/build.ts', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(check.status).toBe(0)
    expect(check.stdout).toContain('PASS')
    const bad = spawnSync(process.execPath, ['scripts/blender/build.ts', '--bogus'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toMatch(/Unknown option --bogus/)
    const unknown = spawnSync(
      process.execPath,
      ['scripts/blender/build.ts', '--selftest', '--id', 'no-such-model'],
      { cwd: ROOT, encoding: 'utf8' },
    )
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toMatch(/Unknown model no-such-model/)
  })
})
