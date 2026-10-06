/**
 * Every file under /data is validated by a zod schema, and the cross-file references hold
 * (copy keys, balance ids, coordinates inside the NYC extent).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { parseDataFile } from './parse'
import {
  BalanceConfigSchema,
  CopyConfigSchema,
  JOB_IDS,
  LayoutConfigSchema,
  ModerationConfigSchema,
  PerfConfigSchema,
  RealtimeConfigSchema,
  ThemeConfigSchema,
} from './schemas/config'
import {
  EventsFileSchema,
  ItemsFileSchema,
  JobsFileSchema,
  LandmarksFileSchema,
  PremiumFileSchema,
  VenuesFileSchema,
} from './schemas/content'
import { BaseCopySchema, SlangPackSchema } from './schemas/copy'
import { AudioManifestSchema, GeoBoundsSchema, ZonesFileSchema } from './schemas/world'
import { balance, perf, realtime, theme } from './config'
import { events, geoBounds, items, jobs, landmarks, premiumItems, venues } from './content'
import { baseCopy } from '@/lib/copy'

const DATA = join(import.meta.dirname, '../../../data')

/** The schema for each data file. Files under copy/packs/ all use SlangPackSchema. */
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'audio/manifest.json': AudioManifestSchema,
  'config/balance.json': BalanceConfigSchema,
  'config/copy.json': CopyConfigSchema,
  'config/layout.json': LayoutConfigSchema,
  'config/moderation.json': ModerationConfigSchema,
  'config/perf.json': PerfConfigSchema,
  'config/realtime.json': RealtimeConfigSchema,
  'config/theme.json': ThemeConfigSchema,
  'copy/base.json': BaseCopySchema,
  'events/events.json': EventsFileSchema,
  'geo/bounds.json': GeoBoundsSchema,
  'items/items.json': ItemsFileSchema,
  'jobs/jobs.json': JobsFileSchema,
  'landmarks/landmarks.json': LandmarksFileSchema,
  'premium/premium.json': PremiumFileSchema,
  'venues/venues.json': VenuesFileSchema,
  'zones/zones.json': ZonesFileSchema,
}

function schemaFor(file: string): z.ZodType | undefined {
  return file.startsWith('copy/packs/') ? SlangPackSchema : SCHEMAS[file]
}

/** Extensions the data loaders parse. Every file with one of these needs a schema. */
const DATA_EXTENSIONS = ['.json', '.geojson']

/** Documentation that may sit next to data (by file name). Everything else must be data. */
const NON_DATA_FILES = new Set(['SOURCES.md', 'README.md'])

/** OS artefacts that are gitignored and never shipped. */
const IGNORED_FILES = new Set(['.DS_Store'])

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && !IGNORED_FILES.has(entry.name))
    .map((entry) => relative(DATA, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

const isDataFile = (file: string) => DATA_EXTENSIONS.some((ext) => file.endsWith(ext))
const baseName = (file: string) => file.split('/').pop() ?? file

/** Files that would ship without validation: unknown types, or data files with no schema. */
function unvalidatedFiles(files: readonly string[]): string[] {
  return files.filter((file) =>
    isDataFile(file) ? schemaFor(file) === undefined : !NON_DATA_FILES.has(baseName(file)),
  )
}

function dataFiles(dir: string): string[] {
  return allFiles(dir).filter(isDataFile)
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

describe('/data files', () => {
  const files = dataFiles(DATA)

  it.each([
    'items',
    'premium',
    'events',
    'jobs',
    'venues',
    'landmarks',
    'geo',
    'zones',
    'audio',
    'config',
    'copy',
  ])('/data/%s has at least one data file', (folder) => {
    expect(files.some((file) => file.startsWith(`${folder}/`))).toBe(true)
  })

  it('every file is a data file with a schema or allowlisted docs, so nothing ships unvalidated', () => {
    expect(unvalidatedFiles(allFiles(DATA))).toEqual([])
  })

  it('the file check rejects unknown types and schema-less .json or .geojson files', () => {
    expect(
      unvalidatedFiles([
        'config/perf.json',
        'geo/SOURCES.md',
        'geo/land.geojson',
        'items/extra.json',
        'audio/notes.txt',
        'geo/land.csv',
        'items/items.yaml',
      ]),
    ).toEqual([
      'geo/land.geojson',
      'items/extra.json',
      'audio/notes.txt',
      'geo/land.csv',
      'items/items.yaml',
    ])
  })

  it.each(dataFiles(DATA))('%s matches its schema', (file) => {
    const schema = schemaFor(file)
    if (schema === undefined) throw new Error(`no schema for ${file}`)
    expect(() => parseDataFile(file, schema, readJson(file))).not.toThrow()
  })

  it('reports the file and the failing path when a file is invalid', () => {
    expect(() => parseDataFile('config/realtime.json', RealtimeConfigSchema, {})).toThrow(
      /config\/realtime\.json[\s\S]*shardSize/,
    )
  })
})

describe('config/perf.json', () => {
  it('holds every budget from CLAUDE.md "Performance budgets"', () => {
    expect(perf).toEqual({
      shellJsGzKB: 180,
      sceneChunkJsGzKB: 350,
      totalJsToPlayableGzKB: 550,
      baseGeoGzKB: 400,
      districtBuildingsGzKB: { low: 150, mid: 300, high: 400 },
      totalBytesToPlayableGzKB: { low: 1200, mid: 1600, high: 2000 },
      shellInteractiveColdMs: 2500,
      playableColdMs: { low: 6000, mid: 7000, high: 8000 },
      playableWarmMs: 2500,
      drawCallsMax: { low: 60, mid: 120, high: 200 },
      trianglesMax: { low: 150_000, mid: 400_000, high: 800_000 },
      dprCap: { low: 1, mid: 1.5, high: 2 },
      shadows: { low: 'none', mid: 'blob-or-baked', high: 'pcf-directional' },
      otherPlayersMax: { low: 8, mid: 16, high: 24 },
      otherPlayersStyle: { low: 'billboard', mid: 'model', high: 'model' },
      medianFpsMin: { low: 30, mid: 45, high: 55 },
      idleFramesMax: 0,
      fpsStepDown: { belowFps: 28, sustainMs: 3000 },
      throttleProfiles: {
        'cc-mid-4g': {
          downloadKbps: 4000,
          uploadKbps: 1000,
          rttMs: 150,
          cpuSlowdown: 4,
          viewport: { width: 390, height: 844 },
        },
      },
    })
  })

  it('rejects a missing tier, an unknown key and a non-positive budget', () => {
    const valid = readJson('config/perf.json') as Record<string, unknown>
    const without = { ...valid, dprCap: { low: 1, mid: 1.5 } }
    expect(PerfConfigSchema.safeParse(without).success).toBe(false)
    expect(PerfConfigSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
    expect(PerfConfigSchema.safeParse({ ...valid, shellJsGzKB: 0 }).success).toBe(false)
    const softShadows = { low: 'none', mid: 'blob-or-baked', high: 'pcf-soft' }
    expect(PerfConfigSchema.safeParse({ ...valid, shadows: softShadows }).success).toBe(false)
  })
})

describe('config/realtime.json and moderation', () => {
  it('uses the defaults from CLAUDE.md', () => {
    expect(realtime).toMatchObject({
      shardSize: 16,
      maxFriendFanout: 50,
      heartbeatIntervalMs: 60_000,
    })
  })

  it('rejects zero or fractional limits', () => {
    const valid = readJson('config/realtime.json') as Record<string, unknown>
    expect(RealtimeConfigSchema.safeParse({ ...valid, shardSize: 0 }).success).toBe(false)
    expect(RealtimeConfigSchema.safeParse({ ...valid, shardSize: 16.5 }).success).toBe(false)
    expect(ModerationConfigSchema.safeParse({ autoHideReports: 0 }).success).toBe(false)
  })
})

describe('config/theme.json', () => {
  it('has the night palette: deep indigo, hot pink, taxi yellow and neutrals', () => {
    expect(Object.keys(theme.colors)).toEqual(
      expect.arrayContaining(['night-950', 'pink-400', 'taxi-400', 'ink-50']),
    )
  })

  it('rejects a bad hex and a themeColor that names no token', () => {
    expect(
      ThemeConfigSchema.safeParse({ colors: { 'pink-400': 'pink' }, themeColor: 'pink-400' })
        .success,
    ).toBe(false)
    expect(
      ThemeConfigSchema.safeParse({ colors: { 'pink-400': '#ff4fa3' }, themeColor: 'nope-1' })
        .success,
    ).toBe(false)
  })
})

describe('config/balance.json', () => {
  it('holds the CLAUDE.md balance anchors', () => {
    expect(balance.time).toEqual({
      gameMinutesPerRealMinute: 10,
      gameDayHours: 24,
      rentPeriodGameDays: 7,
    })
    expect(balance.start).toEqual({ cash: 150, home: 'queens-room' })
    expect(balance.rentPerWeek).toEqual({
      'queens-room': 280,
      'brooklyn-1br': 520,
      'manhattan-loft': 1100,
    })
    expect(balance.jobs).toEqual({
      shiftHours: 4,
      hourlyWage: { barista: 14, retail: 16, delivery: 18, 'junior-dev': 35 },
    })
    expect(balance.costs).toEqual({ food: { min: 4, max: 12 }, subwayFare: 3 })
  })

  it('rejects an inverted range and fractional dollars', () => {
    const valid = readJson('config/balance.json') as Record<string, unknown>
    const costs = { food: { min: 12, max: 4 }, subwayFare: 3 }
    expect(BalanceConfigSchema.safeParse({ ...valid, costs }).success).toBe(false)
    const start = { cash: 150.5, home: 'queens-room' }
    expect(BalanceConfigSchema.safeParse({ ...valid, start }).success).toBe(false)
  })
})

describe('content schemas', () => {
  const item = {
    id: 'tee',
    nameKey: 'items.tee.name',
    category: 'clothing',
    rarity: 'common',
    price: 20,
    sellValue: 8,
    cloutValue: 1,
    statEffects: { mood: 2 },
  }

  it('rejects an item that sells for more than it costs, or an unknown stat', () => {
    expect(ItemsFileSchema.safeParse({ items: [item] }).success).toBe(true)
    expect(ItemsFileSchema.safeParse({ items: [{ ...item, sellValue: 21 }] }).success).toBe(false)
    expect(
      ItemsFileSchema.safeParse({ items: [{ ...item, statEffects: { luck: 1 } }] }).success,
    ).toBe(false)
  })

  it('rejects duplicate ids', () => {
    expect(ItemsFileSchema.safeParse({ items: [item, item] }).success).toBe(false)
  })

  it('rejects a premium item with a sellValue or a non-USD currency', () => {
    const premium = premiumItems[0]
    expect(PremiumFileSchema.safeParse({ items: [{ ...premium, sellValue: 1 }] }).success).toBe(
      false,
    )
    expect(PremiumFileSchema.safeParse({ items: [{ ...premium, currency: 'cash' }] }).success).toBe(
      false,
    )
  })

  it('rejects a landmark with an unknown category or no nameMode', () => {
    const noMode: Record<string, unknown> = { ...landmarks[0] }
    delete noMode.nameMode
    expect(LandmarksFileSchema.safeParse({ landmarks: [noMode] }).success).toBe(false)
    const tower = { ...landmarks[0], category: 'tower' }
    expect(LandmarksFileSchema.safeParse({ landmarks: [tower] }).success).toBe(false)
  })

  it('accepts only CC0 audio tracks with an https source', () => {
    const track = {
      id: 'loop-1',
      channel: 'music',
      file: '/audio/music/loop-1.ogg',
      license: 'CC0-1.0',
      sourceUrl: 'https://example.org/loop-1',
    }
    const manifest = { channels: ['music', 'sfx', 'ambience', 'voice'], tracks: [track] }
    expect(AudioManifestSchema.safeParse(manifest).success).toBe(true)
    const radio = { ...manifest, tracks: [{ ...track, license: 'CC-BY-4.0' }] }
    expect(AudioManifestSchema.safeParse(radio).success).toBe(false)
    const http = { ...manifest, tracks: [{ ...track, sourceUrl: 'http://example.org/x' }] }
    expect(AudioManifestSchema.safeParse(http).success).toBe(false)
  })

  it('rejects a zone without a valid NTA code', () => {
    const zone = { id: 'z', ntaCode: 'Q101', name: 'Z', borough: 'queens' }
    expect(ZonesFileSchema.safeParse({ zones: [zone] }).success).toBe(false)
  })
})

describe('cross-file references', () => {
  const copyKeys = new Set(Object.keys(baseCopy.strings))

  it('every copy key named by content exists in data/copy/base.json', () => {
    const refs = [
      ...items.map((entry) => entry.nameKey),
      ...premiumItems.map((entry) => entry.nameKey),
      ...events.flatMap((entry) => [entry.titleKey, entry.bodyKey]),
      ...jobs.map((entry) => entry.nameKey),
      ...venues.map((entry) => entry.nameKey),
      ...landmarks.map((entry) => entry.nameKey),
    ]
    expect(refs.filter((key) => !copyKeys.has(key))).toEqual([])
  })

  it('jobs and balance wages list the same job ids', () => {
    expect(jobs.map((job) => job.id).sort()).toEqual([...JOB_IDS].sort())
    expect(Object.keys(balance.jobs.hourlyWage).sort()).toEqual([...JOB_IDS].sort())
  })

  it('every premium price tier exists in balance', () => {
    const tiers = Object.keys(balance.premiumPriceTiersUsd)
    expect(premiumItems.filter((entry) => !tiers.includes(entry.priceTier))).toEqual([])
  })

  it('every venue and landmark sits inside the NYC extent', () => {
    const outside = [...venues, ...landmarks].filter(
      ({ location: { lat, lng } }) =>
        lng < geoBounds.west ||
        lng > geoBounds.east ||
        lat < geoBounds.south ||
        lat > geoBounds.north,
    )
    expect(outside).toEqual([])
  })
})
