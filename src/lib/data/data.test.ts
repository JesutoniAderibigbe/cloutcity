/**
 * Every file under /data is validated by a zod schema, and the cross-file references hold
 * (copy keys, balance ids, coordinates inside the NYC extent).
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { parseDataFile } from './parse'
import {
  AudioConfigSchema,
  BalanceConfigSchema,
  type BalanceConfig,
  CopyConfigSchema,
  GeoConfigSchema,
  JOB_IDS,
  LayoutConfigSchema,
  ModerationConfigSchema,
  OnboardingConfigSchema,
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
import { NamespaceBaseSchema, SlangPackSchema, SuperlativesSchema } from './schemas/copy'
import { EconomyBaselineSchema } from './schemas/sim'
import {
  AudioManifestSchema,
  BoroughsFileSchema,
  GeoBoundsSchema,
  GeoManifestSchema,
  LandFileSchema,
  ParksFileSchema,
  SubwayFileSchema,
  WaterFileSchema,
  ZoneShapesFileSchema,
  ZonesFileSchema,
} from './schemas/world'
import { audio, balance, layout, onboarding, perf, realtime, theme } from './config'
import {
  audioManifest,
  events,
  geoBounds,
  items,
  jobs,
  landmarks,
  premiumItems,
  venues,
} from './content'
import { baseCopy } from '@/lib/copy/all'

const DATA = join(import.meta.dirname, '../../../data')

/**
 * The schema for each data file. Copy files are matched by pattern in `schemaFor`: each
 * copy/<ns>/base.json is a NamespaceBaseSchema, any other copy/<ns>/<pack>.json a SlangPackSchema.
 */
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'audio/manifest.json': AudioManifestSchema,
  'boroughs/boroughs.json': BoroughsFileSchema,
  'config/audio.json': AudioConfigSchema,
  'config/balance.json': BalanceConfigSchema,
  'config/copy.json': CopyConfigSchema,
  'config/geo.json': GeoConfigSchema,
  'config/layout.json': LayoutConfigSchema,
  'config/moderation.json': ModerationConfigSchema,
  'config/onboarding.json': OnboardingConfigSchema,
  'config/perf.json': PerfConfigSchema,
  'config/realtime.json': RealtimeConfigSchema,
  'config/theme.json': ThemeConfigSchema,
  'copy/superlatives.json': SuperlativesSchema,
  'events/events.json': EventsFileSchema,
  'geo/bounds.json': GeoBoundsSchema,
  'geo/land.derived.json': LandFileSchema,
  'geo/manifest.derived.json': GeoManifestSchema,
  'geo/parks.derived.json': ParksFileSchema,
  'geo/subway.derived.json': SubwayFileSchema,
  'geo/water.derived.json': WaterFileSchema,
  'items/items.json': ItemsFileSchema,
  'jobs/jobs.json': JobsFileSchema,
  'landmarks/landmarks.json': LandmarksFileSchema,
  'premium/premium.json': PremiumFileSchema,
  'sim/economy-baseline.derived.json': EconomyBaselineSchema,
  'venues/venues.json': VenuesFileSchema,
  'zones/zone-shapes.derived.json': ZoneShapesFileSchema,
  'zones/zones.derived.json': ZonesFileSchema,
}

function schemaFor(file: string): z.ZodType | undefined {
  if (/^copy\/[\w-]+\/base\.json$/.test(file)) return NamespaceBaseSchema
  if (/^copy\/[\w-]+\/[\w-]+\.json$/.test(file)) return SlangPackSchema
  return SCHEMAS[file]
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
    'boroughs',
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
      // S05c: the shell keeps 20 KB of the budget free for features still to land.
      shellHeadroomGzKB: 20,
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
      audioLazyGzKB: { low: 600, mid: 1000, high: 1400 },
      audioFileMaxKB: 600,
      audioRuntimeJsGzKB: 20,
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

describe('config/onboarding.json', () => {
  it('holds the CLAUDE.md age rule: 18+, a 24 h lock on that device', () => {
    expect(onboarding).toMatchObject({ minimumAge: 18, underAgeLockHours: 24 })
    expect(onboarding.birthYearSpan).toBeGreaterThan(onboarding.minimumAge + 1)
  })

  it('rejects a fractional lock, a non-date consent version and a span nobody can pass', () => {
    const valid = readJson('config/onboarding.json') as Record<string, unknown>
    const parse = (patch: Record<string, unknown>) =>
      OnboardingConfigSchema.safeParse({ ...valid, ...patch }).success
    expect(parse({})).toBe(true)
    expect(parse({ underAgeLockHours: 0.5 })).toBe(false)
    expect(parse({ consentVersion: 'v1' })).toBe(false)
    expect(parse({ birthYearSpan: 19 })).toBe(false)
    expect(parse({ extra: true })).toBe(false)
  })
})

describe('config/layout.json', () => {
  it('holds the 300 ms panel action cooldown', () => {
    expect(layout.overlay.actionCooldownMs).toBe(300)
  })

  it('rejects a missing, zero, negative or fractional action cooldown', () => {
    const valid = readJson('config/layout.json') as { overlay: Record<string, unknown> }
    const parse = (patch: Record<string, unknown>) =>
      LayoutConfigSchema.safeParse({ ...valid, overlay: { ...valid.overlay, ...patch } }).success
    expect(parse({})).toBe(true)
    expect(parse({ actionCooldownMs: undefined })).toBe(false)
    expect(parse({ actionCooldownMs: 0 })).toBe(false)
    expect(parse({ actionCooldownMs: -300 })).toBe(false)
    expect(parse({ actionCooldownMs: 300.5 })).toBe(false)
  })
})

describe('config/audio.json', () => {
  it('has a default for every channel and a step that divides 100', () => {
    expect(Object.keys(audio.defaults).sort()).toEqual(
      ['ambience', 'master', 'music', 'sfx', 'voice'].sort(),
    )
    expect(100 % audio.volumeStep).toBe(0)
  })

  it('rejects a step that does not divide 100, off-step defaults and an over-long crossfade', () => {
    const valid = readJson('config/audio.json') as Record<string, unknown>
    const parse = (patch: Record<string, unknown>) =>
      AudioConfigSchema.safeParse({ ...valid, ...patch }).success
    expect(parse({})).toBe(true)
    expect(parse({ volumeStep: 7 })).toBe(false)
    expect(parse({ defaults: { ...audio.defaults, music: 62 } })).toBe(false)
    expect(parse({ defaults: { ...audio.defaults, music: 120 } })).toBe(false)
    expect(parse({ musicCrossfadeSeconds: 500 })).toBe(false)
    expect(parse({ prefetchAheadSeconds: 1 })).toBe(false)
  })
})

describe('data/audio/manifest.json and public/audio', () => {
  const PUBLIC = join(DATA, '../public')
  const sourcesOf = audioManifest.tracks.flatMap((track) =>
    track.sources.map((source) => ({ track, source })),
  )

  it('every file exists in public/ with the recorded size and sha256', () => {
    for (const { source } of sourcesOf) {
      const bytes = readFileSync(join(PUBLIC, source.file))
      expect(bytes.byteLength, source.file).toBe(source.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), source.file).toBe(source.sha256)
    }
  })

  it('public/audio holds nothing the manifest does not list', () => {
    const listed = new Set(sourcesOf.map(({ source }) => source.file))
    const onDisk = readdirSync(join(PUBLIC, 'audio'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
      .map(
        (entry) => `/${relative(PUBLIC, join(entry.parentPath, entry.name)).split('\\').join('/')}`,
      )
    expect(onDisk.filter((file) => !listed.has(file))).toEqual([])
  })

  it('every music track has a "Title by Artist" copy key', () => {
    const keys = new Set(Object.keys(baseCopy.strings))
    for (const track of audioManifest.tracks.filter((entry) => entry.channel === 'music')) {
      expect(track.titleKey !== undefined && keys.has(track.titleKey), track.id).toBe(true)
    }
  })

  it('is CC0 only, from https pages, with every sound listed in SOURCES.md', () => {
    const sourcesMd = readFileSync(join(DATA, 'audio/SOURCES.md'), 'utf8')
    for (const track of audioManifest.tracks) {
      expect(track.license).toBe('CC0-1.0')
      expect(track.sourceUrl.startsWith('https://'), track.id).toBe(true)
      expect(sourcesMd.includes(`\`${track.id}\``), track.id).toBe(true)
      for (const source of track.sources) expect(source.file.startsWith('/audio/')).toBe(true)
    }
  })

  it('every file fits the per-file cap', () => {
    for (const { source } of sourcesOf) {
      expect(statSync(join(PUBLIC, source.file)).size, source.file).toBeLessThanOrEqual(
        perf.audioFileMaxKB * 1000,
      )
    }
  })

  it.each(['low', 'mid', 'high'] as const)(
    'the first music track, the ambience and the %s-tier sfx fit audioLazyGzKB in each encoding',
    (tier) => {
      const byId = new Map(audioManifest.tracks.map((track) => [track.id, track]))
      const initial = [audioManifest.playlists.music[0], audioManifest.playlists.ambience[0]]
      if (audio.tiers[tier].preloadSfx) initial.push(...Object.values(audioManifest.sfx))
      for (const type of ['audio/webm; codecs=opus', 'audio/mp4; codecs=mp4a.40.2']) {
        // Audio is already compressed; gzip would not shrink it, so bytes count as is.
        const bytes = initial.reduce((sum, id) => {
          const source = byId.get(id ?? '')?.sources.find((entry) => entry.type === type)
          if (source === undefined) throw new Error(`${id} has no ${type} source`)
          return sum + source.bytes
        }, 0)
        expect(bytes, `${tier} ${type}`).toBeLessThanOrEqual(perf.audioLazyGzKB[tier] * 1000)
      }
    },
  )
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
    expect(balance.time).toMatchObject({
      gameMinutesPerRealMinute: 10,
      gameDayHours: 24,
      rentPeriodGameDays: 7,
      speeds: [1, 2],
    })
    expect(balance.start).toEqual({ cash: 150, home: 'queens-room' })
    expect(balance.rentPerWeek).toEqual({
      'queens-room': 280,
      'brooklyn-1br': 520,
      'manhattan-loft': 1100,
    })
    expect(balance.jobs).toMatchObject({
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

  it('rejects clock speeds without 1x, stats above the max and oversized actions', () => {
    const valid = readJson('config/balance.json') as BalanceConfig
    const time = (patch: Partial<BalanceConfig['time']>) => ({
      ...valid,
      time: { ...valid.time, ...patch },
    })
    expect(BalanceConfigSchema.safeParse(time({ speeds: [2, 1] })).success).toBe(false)
    expect(BalanceConfigSchema.safeParse(time({ speeds: [1, 1] })).success).toBe(false)
    expect(BalanceConfigSchema.safeParse(time({ startMinuteOfDay: 1440 })).success).toBe(false)
    const stats = { ...valid.stats, start: { ...valid.stats.start, mood: valid.stats.max + 1 } }
    expect(BalanceConfigSchema.safeParse({ ...valid, stats }).success).toBe(false)
    const huge = {
      durationMin: valid.actions.maxDurationMin + 1,
      cashCost: 0,
      energyCost: 0,
      statEffects: {},
    }
    const actions = { ...valid.actions, catalog: { ...valid.actions.catalog, huge } }
    expect(BalanceConfigSchema.safeParse({ ...valid, actions }).success).toBe(false)
    const effect = { durationMin: 1, cashCost: 0, energyCost: 0, statEffects: { mood: -101 } }
    const badEffect = { ...valid.actions, catalog: { effect } }
    expect(BalanceConfigSchema.safeParse({ ...valid, actions: badEffect }).success).toBe(false)
  })

  it('rejects a borough rule with an unknown clout level, a missing borough or bad access', () => {
    const valid = readJson('config/balance.json') as BalanceConfig
    const boroughs = (patch: Record<string, unknown>) => ({
      ...valid,
      boroughs: { ...valid.boroughs, ...patch },
    })
    expect(BalanceConfigSchema.safeParse(boroughs({})).success).toBe(true)
    const mayor = { brooklyn: { access: 'clout', level: 'mayor' } }
    expect(BalanceConfigSchema.safeParse(boroughs(mayor)).success).toBe(false)
    expect(BalanceConfigSchema.safeParse(boroughs({ queens: { access: 'clout' } })).success).toBe(
      false,
    )
    expect(BalanceConfigSchema.safeParse(boroughs({ queens: { access: 'vip' } })).success).toBe(
      false,
    )
    const withoutBronx: Partial<BalanceConfig['boroughs']> = { ...valid.boroughs }
    delete withoutBronx.bronx
    expect(BalanceConfigSchema.safeParse({ ...valid, boroughs: withoutBronx }).success).toBe(false)
  })

  it('rejects venue hours that never open and a station venue without its station', () => {
    const file = readJson('venues/venues.json') as { venues: Record<string, unknown>[] }
    const withVenue = (index: number, patch: Record<string, unknown>) => ({
      venues: [{ ...file.venues[index], ...patch }],
    })
    const station = file.venues.findIndex((venue) => venue.type === 'subway-station')
    const shop = file.venues.findIndex((venue) => venue.type === 'coffee-shop')
    expect(VenuesFileSchema.safeParse(withVenue(shop, {})).success).toBe(true)
    const same = { hours: { open: '09:00', close: '09:00' } }
    expect(VenuesFileSchema.safeParse(withVenue(shop, same)).success).toBe(false)
    const late = { hours: { open: '24:00', close: '09:00' } }
    expect(VenuesFileSchema.safeParse(withVenue(shop, late)).success).toBe(false)
    expect(VenuesFileSchema.safeParse(withVenue(shop, { price: 5 })).success).toBe(false)
    expect(VenuesFileSchema.safeParse(withVenue(shop, { jobIds: ['dj'] })).success).toBe(false)
    expect(VenuesFileSchema.safeParse(withVenue(station, { stationId: undefined })).success).toBe(
      false,
    )
    expect(VenuesFileSchema.safeParse(withVenue(station, { jobIds: ['retail'] })).success).toBe(
      false,
    )
  })

  it('food actions cost within the food range', () => {
    for (const id of ['bodega-breakfast', 'home-meal']) {
      const cost = balance.actions.catalog[id]?.cashCost
      expect(cost, id).toBeGreaterThanOrEqual(balance.costs.food.min)
      expect(cost, id).toBeLessThanOrEqual(balance.costs.food.max)
    }
  })
})

describe('content schemas', () => {
  const item = {
    id: 'tee',
    nameKey: 'items.tee.name',
    descriptionKey: 'items.tee.description',
    category: 'clothing',
    slot: 'top',
    rarity: 'common',
    currency: 'cash',
    price: 20,
    sellValue: 8,
    cloutValue: 1,
    styleValue: 1,
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

  it('accepts only CC0 audio tracks with an https source, served from /audio/', () => {
    const valid = readJson('audio/manifest.json') as { tracks: Record<string, unknown>[] }
    const withTrack = (patch: Record<string, unknown>) => ({
      ...valid,
      tracks: valid.tracks.map((track, index) => (index === 0 ? { ...track, ...patch } : track)),
    })
    const source = (valid.tracks[0]?.sources as Record<string, unknown>[])[0]
    expect(AudioManifestSchema.safeParse(withTrack({})).success).toBe(true)
    expect(AudioManifestSchema.safeParse(withTrack({ license: 'CC-BY-4.0' })).success).toBe(false)
    expect(
      AudioManifestSchema.safeParse(withTrack({ sourceUrl: 'http://example.org/x' })).success,
    ).toBe(false)
    const remote = { ...source, file: 'https://radio.example.org/live.webm' }
    expect(AudioManifestSchema.safeParse(withTrack({ sources: [remote] })).success).toBe(false)
    const wrongType = { ...source, type: 'audio/mp4; codecs=mp4a.40.2' }
    expect(AudioManifestSchema.safeParse(withTrack({ sources: [wrongType] })).success).toBe(false)
    expect(AudioManifestSchema.safeParse(withTrack({ sources: [] })).success).toBe(false)
    expect(AudioManifestSchema.safeParse(withTrack({ titleKey: undefined })).success).toBe(false)
    expect(AudioManifestSchema.safeParse(withTrack({ loopEndMs: 999_999_999 })).success).toBe(false)
  })

  it('rejects playlists and sfx that name a missing track or the wrong channel', () => {
    const valid = readJson('audio/manifest.json') as Record<string, unknown>
    const playlists = { music: ['nyc-night'], ambience: ['nyc-night'] }
    expect(AudioManifestSchema.safeParse({ ...valid, playlists }).success).toBe(false)
    const sfx = { 'ui-tap': 'nope', purchase: 'purchase', 'clout-up': 'clout-up' }
    expect(AudioManifestSchema.safeParse({ ...valid, sfx }).success).toBe(false)
  })

  it('rejects a zone with a bad CDTA or NTA code, no NTAs or a fractional centroid', () => {
    const file = readJson('zones/zones.derived.json') as { zones: Record<string, unknown>[] }
    const zone = file.zones[0]
    const withZone = (patch: Record<string, unknown>) => ({
      ...file,
      zones: [{ ...zone, ...patch }],
    })
    expect(ZonesFileSchema.safeParse(withZone({})).success).toBe(true)
    expect(ZonesFileSchema.safeParse(withZone({ cdtaCode: 'QN1' })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ ntaCodes: ['Q101'] })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ ntaCodes: [] })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ centroid: { x: 1.5, y: 0 } })).success).toBe(false)
  })

  it('rejects a derived geo file that drops its derived flag or names another projection', () => {
    const file = readJson('geo/water.derived.json') as Record<string, unknown>
    expect(WaterFileSchema.safeParse(file).success).toBe(true)
    expect(WaterFileSchema.safeParse({ ...file, derived: false }).success).toBe(false)
    const projection = { id: 'other', originLat: 40.7, originLng: -73.98 }
    expect(WaterFileSchema.safeParse({ ...file, projection }).success).toBe(false)
  })

  it('rejects geo config whose station tolerance is below the simplification error', () => {
    const valid = readJson('config/geo.json') as Record<string, unknown>
    expect(GeoConfigSchema.safeParse(valid).success).toBe(true)
    expect(GeoConfigSchema.safeParse({ ...valid, stationOnLineToleranceM: 8 }).success).toBe(false)
  })
})

describe('cross-file references', () => {
  const copyKeys = new Set(Object.keys(baseCopy.strings))

  // Each content file's keys live in the one namespace its consumer loads (S05c): events in
  // `events` (EventSheet), items in `items` (shopCopy), places in `venues` and `landmarks`
  // (world/places), and so on. A key elsewhere would render as CopyNamespaceNotLoadedError.
  const refsByNamespace: Readonly<Record<string, readonly string[]>> = {
    items: items.flatMap((entry) => [entry.nameKey, entry.descriptionKey]),
    premium: premiumItems.map((entry) => entry.nameKey),
    events: events.flatMap((entry) => [
      entry.titleKey,
      entry.bodyKey,
      ...entry.choices.flatMap((choice) => [choice.labelKey, choice.resultKey]),
    ]),
    jobs: jobs.map((entry) => entry.nameKey),
    venues: venues.flatMap((entry) => [entry.nameKey, entry.blurbKey]),
    landmarks: landmarks.flatMap((entry) => [entry.nameKey, entry.infoKey]),
    club: Object.values(balance.place.clubs).map((club) => club.refusalKey),
  }

  it('every copy key named by content exists in data/copy', () => {
    const refs = Object.values(refsByNamespace).flat()
    expect(refs.filter((key) => !copyKeys.has(key))).toEqual([])
  })

  it.each(Object.entries(refsByNamespace))(
    'content keys for %s live in that copy namespace',
    (namespace, refs) => {
      expect(refs.length).toBeGreaterThan(0)
      expect(refs.filter((key) => !key.startsWith(`${namespace}.`))).toEqual([])
    },
  )

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

describe('economy baseline (S12, read by S18c)', () => {
  const file = readJson('sim/economy-baseline.derived.json') as Record<string, unknown>

  it('rejects a best job with no run, a negative ceiling and an unknown field', () => {
    expect(EconomyBaselineSchema.safeParse(file).success).toBe(true)
    expect(EconomyBaselineSchema.safeParse({ ...file, bestJob: 'junior-dev' }).success).toBe(false)
    const cash = { maxGainPerAction: -1, maxGainPerGameDay: 0, maxGainPerGameHour: 0 }
    expect(EconomyBaselineSchema.safeParse({ ...file, cash }).success).toBe(false)
    expect(EconomyBaselineSchema.safeParse({ ...file, extra: 1 }).success).toBe(false)
  })
})
