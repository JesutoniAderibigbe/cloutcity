/**
 * `npm run blender:build`: builds our own models (DEC-25 landmarks, DEC-28 gap fillers, S16b
 * avatar attachments and retargeted clips) with a pinned Blender, headless, from committed Python
 * scripts, and commits the GLBs under scripts/blender/out/ so the asset build (and CI) never needs
 * Blender.
 *
 *   npm run blender:build              run Blender for every model in the lock, rewrite its hashes
 *   npm run blender:build -- --id <id> only that model (repeatable); the rest of the lock is kept
 *   npm run blender:build -- --check   no Blender: fail if a script, the runner, a data input, a
 *                                      pinned pack file or an output no longer matches the lock
 *   npm run blender:build -- --selftest  build each model (or each --id) twice in Blender and fail
 *                                      unless both builds and the committed GLB are byte-identical
 *   --lock <path>                      another lock (tests use scripts/blender/fixtures/lock.json)
 *
 * A model's inputs are the runner, its script and its `deps` (repository data such as
 * data/avatar/frame.json, S16b). Its `sources` are pack files from the asset cache (the UAL zip,
 * the modular glTFs): each is pinned by the sha256 that scripts/assets/sources.lock.json holds, so
 * `--check` needs no cache and a build refuses a cache file that does not match.
 *
 * Blender runs as `--background --factory-startup --python-exit-code 1` with PYTHONHASHSEED=0,
 * so user preferences and add-ons never leak in and a failing script fails the build. The
 * executable is the lock's (override with BLENDER_BIN); its `--version` must match the pin.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const run = promisify(execFile)

const ROOT = resolve(import.meta.dirname, '../..')
export const BLENDER_LOCK_PATH = join(ROOT, 'scripts/blender/lock.json')
export const SOURCES_LOCK_PATH = join(ROOT, 'scripts/assets/sources.lock.json')
export const CACHE_DIR = join(ROOT, '.cache/assets')
export const RUNNER = 'scripts/blender/run.py'

const repoPath = z
  .string()
  .regex(/^scripts\/blender\/[\w./-]+$/)
  .refine((path) => !path.split('/').includes('..'), { error: 'must not contain ..' })
/** A repository input: a Blender script or runner, or avatar data (data/avatar/frame.json). */
const inputPath = z
  .string()
  .regex(/^(?:scripts\/blender|data\/avatar)\/[\w./-]+$/)
  .refine((path) => !path.split('/').includes('..'), { error: 'must not contain ..' })
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const BlenderLockSchema = z.strictObject({
  version: z.literal(1),
  blender: z.strictObject({
    /** Exact `Blender --version` release, e.g. "5.2.2". */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    executable: z.string().min(1),
  }),
  /** Folder the GLBs are written to (repository-relative). */
  outDir: repoPath,
  models: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      /** The model's build(bpy) script. */
      script: repoPath.refine((path) => path.endsWith('.py'), { error: 'must be a .py script' }),
      /** Repository data the script reads besides itself (e.g. data/avatar/frame.json). */
      deps: z.array(inputPath).optional(),
      /** Pack files from the asset cache, pinned to scripts/assets/sources.lock.json. */
      sources: z
        .array(
          z.strictObject({
            source: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            path: z.string().min(1),
            sha256,
          }),
        )
        .optional(),
      /** Extra arguments for the script (run.py passes them to build(bpy, ctx) as ctx.args). */
      args: z.array(z.string().regex(/^[\w.=-]+$/)).optional(),
      /** sha256 of every input (the runner, the script and its deps), as last built. */
      inputs: z.record(inputPath, sha256).optional(),
      sha256: sha256.optional(),
      bytes: z.int().positive().optional(),
    }),
  ),
})
export type BlenderLock = z.infer<typeof BlenderLockSchema>

const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const write = (line: string) => process.stdout.write(`${line}\n`)

export async function readBlenderLock(path = BLENDER_LOCK_PATH): Promise<BlenderLock> {
  const result = BlenderLockSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
  if (!result.success) throw new Error(`Invalid ${path}:\n${z.prettifyError(result.error)}`)
  return result.data
}

export const outputPath = (lock: BlenderLock, id: string) => `${lock.outDir}/${id}.glb`

type LockedModel = BlenderLock['models'][number]

/** The repository inputs a model's hashes cover: the runner, its script and its deps, sorted. */
export const modelInputs = (model: LockedModel) =>
  [...new Set([RUNNER, model.script, ...(model.deps ?? [])])].sort()

const SourcesLockFiles = z
  .object({
    sources: z.array(
      z
        .object({
          id: z.string(),
          files: z.array(z.object({ path: z.string(), sha256 }).loose()),
        })
        .loose(),
    ),
  })
  .loose()

/** sha256 by `<source>/<path>` from scripts/assets/sources.lock.json (empty when absent). */
export async function readPackPins(path = SOURCES_LOCK_PATH): Promise<Map<string, string>> {
  const pins = new Map<string, string>()
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (text === undefined) return pins
  for (const source of SourcesLockFiles.parse(JSON.parse(text)).sources) {
    for (const file of source.files) pins.set(`${source.id}/${file.path}`, file.sha256)
  }
  return pins
}

/** Where the asset build caches a pack file: a zip by its name, other kinds under the source id. */
export async function cachedPackFile(
  source: string,
  path: string,
  cacheDir = CACHE_DIR,
): Promise<string> {
  for (const candidate of [join(cacheDir, source, ...path.split('/')), join(cacheDir, path)]) {
    if ((await readOrUndefined(candidate)) !== undefined) return candidate
  }
  throw new Error(`${source}/${path} is not in ${cacheDir}; run npm run assets:build once`)
}

async function readOrUndefined(path: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Problems between the committed scripts, runner, outputs and the lock (no Blender needed). */
export async function checkBlenderOutputs(
  lock: BlenderLock,
  root = ROOT,
  pins?: ReadonlyMap<string, string>,
): Promise<string[]> {
  const problems: string[] = []
  const packPins = pins ?? (await readPackPins(join(root, 'scripts/assets/sources.lock.json')))
  for (const model of lock.models) {
    if (model.inputs === undefined || model.sha256 === undefined || model.bytes === undefined) {
      problems.push(`${model.id}: not built yet; run npm run blender:build`)
      continue
    }
    for (const pinned of model.sources ?? []) {
      const expected = packPins.get(`${pinned.source}/${pinned.path}`)
      if (expected === undefined) {
        problems.push(
          `${model.id}: ${pinned.source}/${pinned.path} is not in scripts/assets/sources.lock.json`,
        )
      } else if (expected !== pinned.sha256) {
        problems.push(
          `${model.id}: ${pinned.source}/${pinned.path} was re-pinned since the last Blender build; run npm run blender:build`,
        )
      }
    }
    const expectedInputs = modelInputs(model)
    if (JSON.stringify(Object.keys(model.inputs).sort()) !== JSON.stringify(expectedInputs)) {
      problems.push(`${model.id}: inputs must be exactly ${expectedInputs.join(', ')}`)
    }
    for (const [path, pinned] of Object.entries(model.inputs)) {
      const bytes = await readOrUndefined(join(root, path))
      if (bytes === undefined) problems.push(`${model.id}: input ${path} is missing`)
      else if (hashOf(bytes) !== pinned) {
        problems.push(
          `${model.id}: ${path} changed since the last Blender build; run npm run blender:build`,
        )
      }
    }
    const out = outputPath(lock, model.id)
    const bytes = await readOrUndefined(join(root, out))
    if (bytes === undefined) problems.push(`${model.id}: ${out} is missing`)
    else if (hashOf(bytes) !== model.sha256 || bytes.byteLength !== model.bytes) {
      problems.push(`${model.id}: ${out} does not match its lock sha256`)
    }
  }
  return problems
}

async function checkVersion(executable: string, version: string): Promise<void> {
  const { stdout } = await run(executable, ['--version'], { env: { ...process.env } })
  const first = stdout.split('\n')[0] ?? ''
  if (!new RegExp(`^Blender ${version.replaceAll('.', '\\.')}(?:\\s|$)`).test(first)) {
    throw new Error(`Blender ${version} is pinned, but ${executable} is "${first.trim()}"`)
  }
}

/** What a model script is given besides its own path (see run.py). */
export interface ScriptContext {
  /** Repository-relative input path → absolute path. */
  readonly deps?: Readonly<Record<string, string>>
  /** `<source>/<path>` → absolute path of the sha-checked cache file. */
  readonly sources?: Readonly<Record<string, string>>
  readonly args?: readonly string[]
}

/** Runs one model script headless and returns the exported GLB. */
export async function runBlender(
  executable: string,
  script: string,
  root = ROOT,
  context: ScriptContext = {},
): Promise<Uint8Array> {
  const work = await mkdtemp(join(tmpdir(), 'cc-blender-'))
  try {
    const out = join(work, 'model.glb')
    const extra = [
      ...Object.entries(context.deps ?? {}).flatMap(([key, path]) => ['--dep', `${key}=${path}`]),
      ...Object.entries(context.sources ?? {}).flatMap(([key, path]) => [
        '--source',
        `${key}=${path}`,
      ]),
      ...(context.args ?? []).flatMap((arg) => ['--arg', arg]),
    ]
    await run(
      executable,
      [
        '--background',
        '--factory-startup',
        '--python-exit-code',
        '1',
        '--python',
        join(root, RUNNER),
        '--',
        '--script',
        join(root, script),
        '--out',
        out,
        ...extra,
      ],
      { env: { ...process.env, PYTHONHASHSEED: '0' }, maxBuffer: 64 * 1024 * 1024 },
    )
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** The script context for a model: its deps, and its pack files after a sha256 check. */
async function contextFor(
  model: LockedModel,
  pins: ReadonlyMap<string, string>,
): Promise<{ context: ScriptContext; sources: NonNullable<LockedModel['sources']> }> {
  const deps: Record<string, string> = {}
  for (const dep of model.deps ?? []) deps[dep] = join(ROOT, dep)
  const sources: Record<string, string> = {}
  const pinned: NonNullable<LockedModel['sources']> = []
  for (const entry of model.sources ?? []) {
    const key = `${entry.source}/${entry.path}`
    const expected = pins.get(key)
    if (expected === undefined) throw new Error(`${model.id}: ${key} is not in sources.lock.json`)
    const file = await cachedPackFile(entry.source, entry.path)
    const actual = hashOf(new Uint8Array(await readFile(file)))
    if (actual !== expected) {
      throw new Error(`${model.id}: cached ${key} does not match sources.lock.json`)
    }
    sources[key] = file
    pinned.push({ source: entry.source, path: entry.path, sha256: expected })
  }
  return { context: { deps, sources, args: model.args ?? [] }, sources: pinned }
}

async function build(lockPath: string, only: ReadonlySet<string>): Promise<void> {
  const lock = await readBlenderLock(lockPath)
  const executable = process.env.BLENDER_BIN ?? lock.blender.executable
  await checkVersion(executable, lock.blender.version)
  const pins = await readPackPins()
  const models: BlenderLock['models'] = []
  for (const model of lock.models) {
    if (only.size > 0 && !only.has(model.id)) {
      models.push(model)
      continue
    }
    const { context, sources } = await contextFor(model, pins)
    const bytes = await runBlender(executable, model.script, ROOT, context)
    await writeFile(join(ROOT, outputPath(lock, model.id)), bytes)
    const inputs: Record<string, string> = {}
    for (const path of modelInputs(model)) {
      inputs[path] = hashOf(new Uint8Array(await readFile(join(ROOT, path))))
    }
    models.push({
      ...model,
      ...(sources.length > 0 ? { sources } : {}),
      inputs,
      sha256: hashOf(bytes),
      bytes: bytes.byteLength,
    })
    write(`built ${model.id}: ${outputPath(lock, model.id)} ${bytes.byteLength} B`)
  }
  await writeFile(lockPath, `${JSON.stringify({ ...lock, models }, null, 2)}\n`)
  write(`wrote ${lockPath}`)
}

/**
 * Builds each model twice and compares the two GLBs with each other and with the committed
 * output: the scripts and the runner must be byte-stable (no clock, no hash order, no bpy.ops
 * whose output varies). Writes nothing.
 */
async function selftest(lockPath: string, only: ReadonlySet<string>): Promise<string[]> {
  const lock = await readBlenderLock(lockPath)
  const executable = process.env.BLENDER_BIN ?? lock.blender.executable
  await checkVersion(executable, lock.blender.version)
  const pins = await readPackPins()
  const problems: string[] = []
  for (const model of lock.models) {
    if (only.size > 0 && !only.has(model.id)) continue
    const { context } = await contextFor(model, pins)
    const first = await runBlender(executable, model.script, ROOT, context)
    const second = await runBlender(executable, model.script, ROOT, context)
    const committed = await readOrUndefined(join(ROOT, outputPath(lock, model.id)))
    if (hashOf(first) !== hashOf(second)) problems.push(`${model.id}: two builds differ`)
    else if (committed === undefined || hashOf(committed) !== hashOf(first)) {
      problems.push(`${model.id}: a fresh build differs from ${outputPath(lock, model.id)}`)
    } else write(`same ${model.id}: ${first.byteLength} B, sha256 ${hashOf(first).slice(0, 12)}`)
  }
  return problems
}

interface Args {
  readonly check: boolean
  readonly selftest: boolean
  readonly lockPath: string
  readonly only: ReadonlySet<string>
}

function parseArgs(argv: readonly string[]): Args {
  let check = false
  let selftest = false
  let lockPath = BLENDER_LOCK_PATH
  const only = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') check = true
    else if (arg === '--selftest') selftest = true
    else if (arg === '--lock' && argv[i + 1] !== undefined)
      lockPath = resolve(ROOT, argv[++i] ?? '')
    else if (arg === '--id' && argv[i + 1] !== undefined) only.add(argv[++i] ?? '')
    else throw new Error(`Unknown option ${arg}`)
  }
  return { check, selftest, lockPath, only }
}

async function main(): Promise<void> {
  const { check, selftest: self, lockPath, only } = parseArgs(process.argv.slice(2))
  const lock = await readBlenderLock(lockPath)
  const unknown = [...only].filter((id) => !lock.models.some((model) => model.id === id))
  if (unknown.length > 0) throw new Error(`Unknown model ${unknown.join(', ')}`)
  if (check) {
    const problems = await checkBlenderOutputs(lock)
    for (const problem of problems) write(`FAIL ${problem}`)
    if (problems.length > 0) {
      process.exitCode = 1
      return
    }
    write('PASS Blender outputs match their scripts and the lock')
    return
  }
  if (self) {
    const problems = await selftest(lockPath, only)
    for (const problem of problems) write(`FAIL ${problem}`)
    if (problems.length > 0) {
      process.exitCode = 1
      return
    }
    write('PASS every Blender build is byte-identical to the last and to the lock')
    return
  }
  await build(lockPath, only)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `blender:build: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
