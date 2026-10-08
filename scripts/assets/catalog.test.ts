/**
 * data/assets/catalog.json (S04h, DEC-24/25/28): only CC0/MIT packs and our own Blender scripts,
 * every token, copy key and Blender output it names exists, and nothing excluded for LEGAL
 * reasons (the police car) slipped in.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ThemeConfigSchema } from '../../src/lib/data/schemas/config.ts'
import { readBlenderLock } from '../blender/build.ts'
import { catalogProblems, readCatalog } from './build.ts'
import { CatalogSchema, LICENCES, PACK_LICENCES } from './schema.ts'

const ROOT = join(import.meta.dirname, '../..')
const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(join(ROOT, path), 'utf8'))

const catalog = await readCatalog()
const theme = ThemeConfigSchema.parse(await readJson('data/config/theme.json'))
const copy = (await readJson('data/copy/models/base.json')) as { strings: Record<string, string> }
const copyKeys = new Set(Object.keys(copy.strings))
const blender = await readBlenderLock()

describe('data/assets/catalog.json', () => {
  it('uses only allowlisted licences: CC0/MIT packs, project-original Blender scripts', () => {
    expect(LICENCES).toEqual(['CC0-1.0', 'MIT', 'project-original'])
    for (const source of catalog.sources) {
      if (source.kind === 'cc0-pack') expect(PACK_LICENCES).toContain(source.licence)
      else expect(source.licence).toBe('project-original')
    }
  })

  it('rejects a pack with any other licence (fixture)', async () => {
    const result = CatalogSchema.safeParse(
      await readJson('scripts/assets/fixtures/catalog-unlicensed.json'),
    )
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/licence/)
  })

  it('rejects a project-original pack, a Blender source with a CC0 licence and http downloads', () => {
    const [pack] = catalog.sources
    if (pack === undefined) throw new Error('catalog has no sources')
    const withSource = (source: unknown) => ({ ...catalog, sources: [source] })
    expect(
      CatalogSchema.safeParse(withSource({ ...pack, licence: 'project-original' })).success,
    ).toBe(false)
    const blenderSource = catalog.sources.find((source) => source.kind === 'blender-script')
    expect(
      CatalogSchema.safeParse(withSource({ ...blenderSource, licence: 'CC0-1.0' })).success,
    ).toBe(false)
    if (pack.download.kind === 'github-raw') {
      const unpinned = { ...pack, download: { ...pack.download, commit: 'main' } }
      expect(CatalogSchema.safeParse(withSource(unpinned)).success).toBe(false)
    }
    const zip = catalog.sources.find((source) => source.download.kind === 'zip')
    if (zip?.download.kind === 'zip') {
      const http = { ...zip, download: { ...zip.download, url: 'http://kenney.nl/a.zip' } }
      expect(CatalogSchema.safeParse(withSource(http)).success).toBe(false)
    }
  })

  it('pins the planned packs: KayKit commits, Kenney zips, Quaternius Drive files and itch upload', () => {
    const pins = catalog.sources.map((source) => {
      const { download } = source
      if (download.kind === 'github-raw') return download.commit
      if (download.kind === 'zip') return download.url
      if (download.kind === 'gdrive-files') return download.files.map((file) => file.id).join(',')
      if (download.kind === 'itch') return `${download.page}#${download.uploadId}`
      return download.root
    })
    expect(pins).toEqual([
      '63976910ca04d16f0fc531b9c614244be8128713',
      '96d5930a8dbdb363409bbc2d3341718b00e17c9c',
      '153c8a7535b48237854cb54ff6890679f8c574d1',
      'https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip',
      'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip',
      'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip',
      'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
      [
        '1lIFL16xEpoPbr0j_HUATgmcEnAmYoIK2',
        '18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh',
        '1GjWtofxjmPku25cXJxHrzLLeUbXw7A_s',
        '1iwF_fqDErPH9uyol6NmS-MnzGgsZ5ejV',
        '1iayBzVv_zLjuPtaNPouw_auwKlQLLmes',
        '1ITb_iFiroAsmjQI38z_p6nNXinwliVLA',
        '1uxAFnDp73NO1c16LvHHjAYh1-deMNk5I',
      ].join(','),
      [
        '1TTvylHa1CsiJuHFWWiv6PFGhLM-aAH5z',
        '1Jn7kULNmrtqP8BUUL19h8MhbdOnwPFhv',
        '1em1So1xwwQNfHJYMvzKcXkZllvtxpKP5',
        '1NhXHnGU0zK9hBrT5FoZp8nTz_EmvTPg5',
        '14d8n7IDnnlnGt_uiATnNg3uvi_4dyd9V',
        '1IL1YJPJvNkuGnKI69-W-VMBIDCo-u49N',
        '1yHWu5ezXq4dYBcn4sWiNd16YN9fMtXo0',
        '1B9Dln-oR5Yk6sdsDR3yHCw86LobAN3Zd',
        '1fzSq1Rr037f7QkfXPWEAzmbLMNx-FpPA',
      ].join(','),
      'https://quaternius.itch.io/universal-animation-library#17958403',
      'scripts/blender/out',
    ])
  })

  it('pins the Quaternius packs to the CC0 licence text (S16b)', () => {
    const quaternius = catalog.sources.filter((source) => source.author === 'Quaternius')
    expect(quaternius.map((source) => source.id)).toEqual([
      'quaternius-modular-women',
      'quaternius-modular-men',
      'quaternius-ual',
    ])
    for (const source of quaternius) {
      expect(source.licence).toBe('CC0-1.0')
      expect(source.licenceEvidence.mustContain).toEqual([
        'CC0 1.0 Universal (CC0 1.0)',
        'https://creativecommons.org/publicdomain/zero/1.0/',
      ])
    }
    expect(catalog.excluded.some((entry) => entry.item === 'Quaternius packs')).toBe(false)
  })

  it('has no cross-file problems: tokens, copy keys and Blender outputs all exist', () => {
    expect(catalogProblems(catalog, theme.models, copyKeys, blender)).toEqual([])
  })

  it('reports unknown tokens, missing copy keys and Blender outputs that were never built', () => {
    const [model] = catalog.models
    if (model === undefined) throw new Error('catalog has no models')
    const blenderSource = catalog.sources.find((source) => source.kind === 'blender-script')
    const broken = {
      ...catalog,
      models: [
        { ...model, swatches: [...model.swatches, 'neon-500'], nameKey: 'models.name.nope' },
        { ...model, id: 'landmark', source: blenderSource?.id ?? '', entries: [{ path: 'x.glb' }] },
      ],
    }
    expect(catalogProblems(broken, theme.models, copyKeys, blender)).toEqual([
      `${model.id}: neon-500 is not a theme models token`,
      `${model.id}: copy key models.name.nope is missing`,
      'landmark: x.glb is not a model in scripts/blender/lock.json',
    ])
  })

  it('leaves out the police car and records why (LEGAL)', () => {
    const entries = catalog.models.flatMap((model) => model.entries.map((entry) => entry.path))
    expect(entries.filter((path) => /police/i.test(path))).toEqual([])
    expect(catalog.excluded.some((item) => /police/i.test(item.item))).toBe(true)
  })

  it('gives every models token a human colour name (A11Y-1/2)', () => {
    const missing = Object.keys(theme.models).filter(
      (token) => !copyKeys.has(`models.color.${token.replace('-', '')}`),
    )
    expect(missing).toEqual([])
  })

  it('shares one rig scale across every avatar part, so heads, bodies and accessories line up', () => {
    const avatar = catalog.models.filter((model) => model.category.startsWith('avatar-'))
    // Each pack's parts share one fitted rig scale (Kenney 2.2, the Quaternius modular packs 1,
    // already in metres); Blender attachments are modelled in the fitted frame
    // (scripts/blender/avatar/), so they keep scale 1 and name the joint they follow.
    const packs = new Set(
      avatar.filter((m) => m.source !== 'clout-city-blender').map((m) => m.source),
    )
    for (const pack of packs) {
      const scales = new Set(
        avatar
          .filter((model) => model.source === pack)
          .map((model) => ('scale' in model.fit ? model.fit.scale : NaN)),
      )
      expect(scales.size, pack).toBe(1)
    }
    const quaternius = avatar.filter((model) => model.source.startsWith('quaternius-modular'))
    for (const model of quaternius) expect(model.fit, model.id).toEqual({ scale: 1 })
    for (const model of avatar.filter((m) => m.source === 'clout-city-blender')) {
      expect(model.fit, model.id).toEqual({ scale: 1 })
      expect(model.pivot, model.id).toBe('source')
      expect(model.kind === 'static' && model.attach !== undefined, model.id).toBe(true)
    }
    expect(quaternius.filter((model) => model.category === 'avatar-head')).toHaveLength(2)
    expect(quaternius.filter((model) => model.id.startsWith('outfit-'))).toHaveLength(14)
    expect(quaternius.filter((model) => model.kind === 'rig').map((model) => model.id)).toEqual([
      'avatar-rig-f',
      'avatar-rig-m',
    ])
  })

  it('maps the modular rig to 22 kebab-case joints, with head and torso for attachments', () => {
    const map = catalog.jointMaps?.modular
    const names = Object.values(map?.rename ?? {})
    expect(names).toHaveLength(22)
    expect(names).toContain('head')
    expect(names).toContain('torso')
  })
})
