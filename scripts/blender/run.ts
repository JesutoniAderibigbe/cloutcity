/**
 * `npm run landmarks:blender`: builds the Blender landmark models (S07c, DEC-25).
 *
 *   npm run landmarks:blender                    build every measured landmark, ship its
 *                                                compressed GLBs, write its lock and SOURCES.md
 *   npm run landmarks:blender -- --id <id>       one landmark
 *   npm run landmarks:blender -- --preview       also render review PNGs into /previews
 *   npm run landmarks:blender -- --variant <name> [--caps <low/mid/high>] [--true-scale]
 *                                                an exploratory build (other caps, or the real
 *                                                proportions instead of the game scale) into
 *                                                .cache/blender/<id>/<name> only (never shipped)
 *   npm run landmarks:blender -- --verify        rebuild and byte-compare with what ships
 *   npm run landmarks:blender -- --selftest      the in-Blender self-test (scripts/blender/selftest.py)
 *   npm run landmarks:check                      no Blender: the locks match the inputs and the
 *                                                shipped files, and SOURCES.md is current
 *
 * Blender comes from $BLENDER or `blender` on PATH and must be the version in scripts/blender/PIN
 * (the build exits 3 otherwise). It always runs headless with a factory startup, no audio and
 * --python-exit-code 1, so a Python error fails the run. Each level is then merged and compressed
 * into the S04h runtime format by ship.ts.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import {
  BlenderLockSchema,
  LandmarkMeasurementsSchema,
  type BlenderLock,
} from '../../src/lib/data/schemas/landmarkBlender.ts'
import {
  BLENDER_DIR,
  LOCK_DIR,
  MEASUREMENTS_DIR,
  ROOT,
  SHIPPED_DIR,
  fileSha,
  inputsSha,
  measuredIds,
} from './inputs.ts'
import { shipLevel } from './ship.ts'
import { renderSection, withSection, type MeasuredLandmark } from './sources-md.ts'

const CACHE = join(ROOT, '.cache/blender')
const PREVIEWS = join(ROOT, 'previews/landmarks')
const SOURCES_MD = join(ROOT, 'data/landmarks/SOURCES.md')
const LEVELS = [0, 1, 2, 3] as const

const write = (line: string) => process.stdout.write(`${line}\n`)

const ReportSchema = z.object({
  blender: z.object({ version: z.string(), buildHash: z.string() }),
  caps: z.object({ low: z.int(), mid: z.int(), high: z.int() }),
  levels: z.array(
    z.object({
      level: z.int(),
      triangles: z.int(),
      glb: z.object({ bytes: z.int(), sha256: z.string() }),
    }),
  ),
  problems: z.array(z.string()),
  placement: z.object({
    topM: z.number(),
    exclusions: z.array(
      z.object({
        x: z.number(),
        y: z.number(),
        halfLengthM: z.number(),
        halfWidthM: z.number(),
        angleDeg: z.number(),
      }),
    ),
  }),
})
type Report = z.infer<typeof ReportSchema>

interface Options {
  readonly ids: readonly string[]
  readonly mode: 'build' | 'check' | 'verify' | 'selftest'
  readonly preview: boolean
  readonly variant: string | undefined
  readonly caps: string | undefined
  readonly trueScale: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    if (i === -1) return undefined
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`)
    return next
  }
  const id = value('--id')
  const variant = value('--variant')
  const caps = value('--caps')
  const trueScale = argv.includes('--true-scale')
  if (variant === undefined && (caps !== undefined || trueScale)) {
    throw new Error('--caps and --true-scale need a --variant (they are never shipped)')
  }
  if (variant !== undefined && !/^[a-z0-9-]+$/.test(variant)) throw new Error('bad --variant')
  const mode = argv.includes('--check')
    ? 'check'
    : argv.includes('--verify')
      ? 'verify'
      : argv.includes('--selftest')
        ? 'selftest'
        : 'build'
  return {
    ids: id === undefined ? measuredIds() : [id],
    mode,
    preview: argv.includes('--preview'),
    variant,
    caps,
    trueScale,
  }
}

function blender(script: string, args: readonly string[]): void {
  const binary = process.env.BLENDER ?? 'blender'
  const result = spawnSync(
    binary,
    [
      '-b',
      '--factory-startup',
      '-noaudio',
      '--python-exit-code',
      '1',
      '-P',
      join(BLENDER_DIR, script),
      '--',
      ...args,
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (result.error !== undefined) throw result.error
  // Only the scripts' own summary lines; the exporter's INFO chatter stays out of the log.
  for (const line of result.stdout.split('\n')) {
    if (/^(L\d|selftest:|build:)/.test(line)) write(`  ${line}`)
  }
  if (result.status !== 0) {
    throw new Error(`blender ${script} exited ${result.status ?? result.signal}`)
  }
}

function readReport(dir: string): Report {
  return ReportSchema.parse(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')))
}

const lockPath = (id: string) => join(LOCK_DIR, `${id}.lock.json`)
const shippedPath = (id: string, level: number) => join(SHIPPED_DIR, id, `lod${level}.glb`)

export function readLock(id: string): BlenderLock | undefined {
  if (!existsSync(lockPath(id))) return undefined
  return BlenderLockSchema.parse(JSON.parse(readFileSync(lockPath(id), 'utf8')))
}

function measured(ids: readonly string[]): MeasuredLandmark[] {
  return ids.map((id) => ({
    measurements: LandmarkMeasurementsSchema.parse(
      JSON.parse(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`), 'utf8')),
    ),
    lock: readLock(id),
  }))
}

function writeSources(): void {
  const markdown = readFileSync(SOURCES_MD, 'utf8')
  writeFileSync(SOURCES_MD, withSection(markdown, renderSection(measured(measuredIds()))))
}

interface Shipped {
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly triangles: number
}

/** Runs build.py into `out`, then ships every level into `out/ship/lod<n>.glb`. */
async function buildInto(
  id: string,
  out: string,
  extra: readonly string[],
): Promise<{ report: Report; shipped: Shipped[] }> {
  blender('build.py', ['--id', id, '--out', out, ...extra])
  const report = readReport(out)
  mkdirSync(join(out, 'ship'), { recursive: true })
  const shipped: Shipped[] = []
  for (const level of LEVELS) {
    const tier = await shipLevel(readFileSync(join(out, `lod${level}.glb`)), id, level)
    writeFileSync(join(out, 'ship', `lod${level}.glb`), tier.bytes)
    shipped.push({
      bytes: tier.bytes,
      sha256: fileSha(join(out, 'ship', `lod${level}.glb`)),
      triangles: tier.triangles,
    })
  }
  return { report, shipped }
}

async function build(id: string, options: Options): Promise<void> {
  const label = options.variant ?? 'shipped'
  const out = join(CACHE, id, label)
  write(`${id} (${label}):`)
  const { report, shipped } = await buildInto(id, out, [
    ...(options.caps === undefined ? [] : ['--caps', options.caps]),
    ...(options.trueScale ? ['--true-scale'] : []),
  ])
  for (const level of report.levels) {
    const ship = shipped[level.level]
    if (ship === undefined || ship.triangles !== level.triangles) {
      throw new Error(`${id} L${level.level}: shipped triangles differ from the build`)
    }
    write(
      `  L${level.level}: ${level.triangles} tris, ${ship.bytes.byteLength} B shipped ` +
        `(${Math.round(ship.bytes.byteLength / level.triangles)} B/tri), ${level.glb.bytes} B uncompressed`,
    )
  }
  if (options.preview) {
    blender('preview.py', [
      '--id',
      id,
      '--glb',
      out,
      '--out',
      join(PREVIEWS, id, label),
      '--label',
      label,
      // Beside the true-scale build, when one has been made (--variant truescale --true-scale).
      ...(label !== 'truescale' && existsSync(join(CACHE, id, 'truescale', 'report.json'))
        ? ['--compare', join(CACHE, id, 'truescale')]
        : []),
    ])
    write(`  previews: ${relative(ROOT, join(PREVIEWS, id, label))}`)
  }
  if (options.variant !== undefined) return

  mkdirSync(join(SHIPPED_DIR, id), { recursive: true })
  for (const level of LEVELS)
    writeFileSync(shippedPath(id, level), shipped[level]?.bytes ?? new Uint8Array())
  const lock: BlenderLock = {
    version: 1,
    id,
    blender: report.blender,
    inputsSha: inputsSha(id),
    caps: report.caps,
    placement: report.placement,
    levels: report.levels.map((level) => ({
      level: level.level,
      file: relative(ROOT, shippedPath(id, level.level)).split('\\').join('/'),
      sha256: shipped[level.level]?.sha256 ?? '',
      bytes: shipped[level.level]?.bytes.byteLength ?? 0,
      triangles: level.triangles,
      uncompressedBytes: level.glb.bytes,
    })),
  }
  mkdirSync(LOCK_DIR, { recursive: true })
  writeFileSync(lockPath(id), `${JSON.stringify(BlenderLockSchema.parse(lock), null, 2)}\n`)
}

/** Problems with a landmark's lock, its shipped files and SOURCES.md (no Blender needed). */
export function checkLandmark(id: string): string[] {
  const lock = readLock(id)
  if (lock === undefined) return [`${id}: no lock; run npm run landmarks:blender -- --id ${id}`]
  const problems: string[] = []
  if (lock.inputsSha !== inputsSha(id)) {
    problems.push(`${id}: inputs changed since the last build; run npm run landmarks:blender`)
  }
  for (const level of lock.levels) {
    const path = join(ROOT, level.file)
    if (!existsSync(path)) problems.push(`${id}: ${level.file} is missing`)
    else if (fileSha(path) !== level.sha256)
      problems.push(`${id}: ${level.file} does not match the lock`)
  }
  return problems
}

export function sourcesProblems(): string[] {
  const markdown = readFileSync(SOURCES_MD, 'utf8')
  const expected = withSection(markdown, renderSection(measured(measuredIds())))
  return markdown === expected ? [] : ['data/landmarks/SOURCES.md measurements section is stale']
}

async function verify(id: string): Promise<string[]> {
  const { shipped } = await buildInto(id, join(CACHE, 'verify', id), [])
  const lock = readLock(id)
  return shipped.flatMap((level, i) =>
    lock?.levels[i]?.sha256 === level.sha256
      ? []
      : [`${id}: L${i} rebuilds to different bytes than ship`],
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  let problems: string[] = []
  if (options.mode === 'check') {
    problems = [...options.ids.flatMap(checkLandmark), ...sourcesProblems()]
  } else if (options.mode === 'verify') {
    for (const id of options.ids) problems.push(...(await verify(id)))
  } else if (options.mode === 'selftest') {
    for (const id of options.ids) blender('selftest.py', ['--id', id])
  } else {
    for (const id of options.ids) await build(id, options)
    if (options.variant === undefined) writeSources()
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`)
  if (problems.length > 0) process.exit(1)
  write(`landmarks:blender ${options.mode}: ok (${options.ids.join(', ')})`)
}

if (import.meta.main) await main()
