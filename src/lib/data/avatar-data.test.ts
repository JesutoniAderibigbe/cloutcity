/**
 * S16a data across files: the look options (data/avatar/options.json), traits, the creator
 * config, the career block and the items' `look`, against the S04h model manifest, the model
 * palette (theme.json `models`) and the copy.
 * Every id resolves, except the models options.json lists as `pending` (S16b P2a: the Blender
 * attachments being refitted to the realistic frame), which may be absent until they land.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { effectiveLook } from '@/engine/avatarLook'
import { creatorSteps } from '@/engine/creatorFlow'
import { resaleValue, shopItems } from '@/engine/items'
import { scaleByPct } from '@/engine/traits'
import { baseCopy } from '@/lib/copy/all'
import { placeholdersOf } from '@/lib/placeholders'
import {
  careerBonusLine,
  careerGoalLine,
  careerName,
  neighborhoodName,
  traitEffectKey,
  traitEffectLines,
  traitFlavor,
  traitName,
} from '@/lib/creatorCopy'
import { balance, theme } from './config'
import { items } from './content'
import { ModelManifestSchema } from './schemas/assets'
import {
  AvatarCompatSchema,
  AvatarOptionsSchema,
  TraitsFileSchema,
  lookIssue,
} from './schemas/avatar'
import { CAREER_PATHS } from './schemas/config'
import { CreatorConfigSchema } from './schemas/creator'

const DATA = join(import.meta.dirname, '../../../data')
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

const options = AvatarOptionsSchema.parse(readJson('avatar/options.json'))
const compat = AvatarCompatSchema.parse(readJson('avatar/compat.json'))
const traits = TraitsFileSchema.parse(readJson('avatar/traits.json'))
const creator = CreatorConfigSchema.parse(readJson('config/creator.json'))
const manifest = ModelManifestSchema.parse(readJson('assets/manifest.json'))
const modelIds = new Set(manifest.models.map((model) => model.id))
const tokens = new Set(Object.keys(theme.models))
const strings = baseCopy.strings

const outfitBodies = options.outfits.flatMap((outfit) =>
  Object.values(outfit.variants).filter((id) => id !== undefined),
)

/** Every catalog model id the options and items name. */
function referencedModels(): string[] {
  const models = [
    ...options.bodies.flatMap((body) => [body.head, body.rig]),
    ...options.hairStyles.flatMap((style) => (style.piece ? [style.piece] : [])),
    ...[...options.facialHair, ...options.headwear, ...options.eyewear, ...options.ears].flatMap(
      (option) => (option.model === undefined ? [] : [option.model]),
    ),
    ...outfitBodies,
    ...items.flatMap((item) => (item.look?.part === 'attachment' ? [item.look.model] : [])),
  ]
  return [...new Set(models)]
}

function referencedTokens(): string[] {
  return [
    ...new Set(
      [...options.skinTones, ...options.hairColors, ...options.garmentColors].map((c) => c.token),
    ),
  ]
}

describe('look options resolve (S04h catalog and palette)', () => {
  it('every model id is in the manifest, unless it is pending its refit', () => {
    const absent = referencedModels().filter((id) => !modelIds.has(id))
    expect(absent.filter((id) => !compat.pending.includes(id))).toEqual([])
    // Nothing stays pending once it ships, and nothing pending is a face, rig or body.
    for (const body of options.bodies) {
      for (const id of [body.head, body.rig]) expect(compat.pending).not.toContain(id)
    }
    for (const id of outfitBodies) expect(compat.pending).not.toContain(id)
  })

  it('every palette token is in theme.json models', () => {
    const missing = referencedTokens().filter((t) => !tokens.has(t))
    expect(missing).toEqual([])
  })

  it('heads, bodies and attachments sit in their own categories (GR-12)', () => {
    // A pending model (S16b P2a) is checked once it lands.
    const category = (id: string) =>
      compat.pending.includes(id) && !modelIds.has(id)
        ? 'pending'
        : manifest.models.find((model) => model.id === id)?.category
    for (const body of options.bodies) {
      expect(category(body.head), body.id).toBe('avatar-head')
      expect(category(body.rig), body.id).toBe('avatar-rig')
    }
    for (const id of outfitBodies) expect(category(id), id).toBe('avatar-body')
    for (const option of [...options.facialHair, ...options.eyewear, ...options.ears]) {
      if (option.model !== undefined) {
        expect(category(option.model), option.id).toMatch(/^(?:avatar-accessory|pending)$/)
      }
    }
    for (const style of options.hairStyles) {
      if (style.piece !== undefined)
        expect(category(style.piece), style.id).toMatch(/^(?:avatar-hair|pending)$/)
    }
    for (const option of options.headwear) {
      if (option.model !== undefined) {
        expect(category(option.model), option.id).toMatch(/^(?:avatar-hair|pending)$/)
      }
    }
    for (const item of items) {
      if (item.look?.part === 'attachment') {
        expect(category(item.look.model), item.id).toMatch(/^(?:avatar-accessory|pending)$/)
      }
    }
  })

  it('the worst look the options allow fits perf.json avatar.trianglesMax on every tier', () => {
    const perf = readJson('config/perf.json') as {
      avatar: { trianglesMax: Record<'low' | 'mid' | 'high', number> }
    }
    const attachmentItems = items.filter((item) => item.look?.part === 'attachment')
    const bodies = outfitBodies
    const tris = (id: string, tier: 'low' | 'mid' | 'high') =>
      manifest.models.find((model) => model.id === id)?.tiers[tier].triangles ?? NaN
    for (const tier of ['low', 'mid', 'high'] as const) {
      // The body is independent of the head side, so the largest one bounds every outfit.
      const body = Math.max(...bodies.map((id) => tris(id, tier)))
      let worst = 0
      for (const hairStyle of options.hairStyles)
        for (const facialHair of options.facialHair)
          for (const headwear of options.headwear)
            for (const eyewear of options.eyewear)
              for (const ears of options.ears)
                for (const worn of [[], ...attachmentItems.map((item) => [item.id])]) {
                  const look = {
                    ...engineConfig.avatar.defaults,
                    hairStyle: hairStyle.id,
                    facialHair: facialHair.id,
                    headwear: headwear.id,
                    eyewear: eyewear.id,
                    ears: ears.id,
                  }
                  const drawn = effectiveLook({ look, worn }, engineConfig, creatorConfig)
                  // A pending attachment is not drawn (S16b), so it adds nothing yet.
                  const shown = (id: string) => (modelIds.has(id) ? tris(id, tier) : 0)
                  const total =
                    tris(drawn.head, tier) +
                    drawn.attachments.reduce((sum, id) => sum + shown(id), 0)
                  worst = Math.max(worst, total)
                }
      expect(worst + body, tier).toBeLessThanOrEqual(perf.avatar.trianglesMax[tier])
    }
  })
})

describe('look options (D2, D5–D8)', () => {
  it('ship the planned counts: 12 skin tones, 10 hair colours, 11 garment and 4 shoe colours, 3 heights', () => {
    expect(options.skinTones).toHaveLength(12)
    expect(options.hairColors).toHaveLength(10)
    expect(options.garmentColors).toHaveLength(11)
    expect(options.shoeColors).toHaveLength(4)
    expect(options.heights.map((height) => height.scale)).toEqual([0.96, 1, 1.04])
    expect(options.outfits).toHaveLength(9)
    expect(options.bodies.map((body) => body.id)).toEqual(['woman', 'man'])
  })

  it('offer the pack hairstyles and the 5 inclusive Blender styles to every body (S16b)', () => {
    const blender = ['afro', 'box-braids', 'buzz', 'cornrows', 'locs']
    const pieces = options.hairStyles.filter((style) => style.piece !== undefined)
    expect(pieces.length - blender.length).toBeGreaterThanOrEqual(8)
    for (const id of blender) expect(pieces.map((style) => style.id)).toContain(id)
    expect(options.hairStyles.some((style) => style.piece === undefined)).toBe(true)
  })

  it('maps every Kenney-era hairstyle and outfit id, and every old outfit to a body', () => {
    const old = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
    for (const n of old) {
      const style = compat.legacy.ids[`style-${n}`]
      expect(
        options.hairStyles.some((option) => option.id === style),
        n,
      ).toBe(true)
      expect(compat.legacy.ids[`outfit-${n}`], n).toBeDefined()
      const body = compat.legacy.body[`outfit-${n}`]
      const outfit = options.outfits.find((o) => o.id === compat.legacy.ids[`outfit-${n}`])
      expect(body === undefined ? undefined : outfit?.variants[body], n).toBeDefined()
    }
  })

  it('keep categories apart: hair, facial hair, head coverings, eyewear and ears (GR-12)', () => {
    expect(
      options.facialHair.every((o) => o.model === undefined || o.model.startsWith('facial-')),
    ).toBe(true)
    expect(
      options.headwear.every((o) => o.model === undefined || o.model.startsWith('headwear-')),
    ).toBe(true)
    expect(options.hairStyles.every((style) => style.piece?.startsWith('hair-') ?? true)).toBe(true)
  })

  it('the engine reads the same options and the defaults are a valid look', () => {
    expect(creatorConfig.options).toEqual(options)
    expect(lookIssue(options.defaults, engineConfig.avatar)).toBeNull()
  })
})

describe('every swatch and option has a human name (A11Y-1)', () => {
  /** Food words are never colour names (A11Y-1). */
  const FOOD =
    /\b(cream|mustard|olive|honey|caramel|chestnut|espresso|chocolate|coffee|mocha|peach|cinnamon|almond|vanilla|butter|cocoa|toffee|oatmeal|cherry|lemon|plum|wine|apricot|salmon|wheat|ginger)\b/i
  const categories = {
    skinTones: options.skinTones,
    hairColors: options.hairColors,
    garmentColors: options.garmentColors,
    hairStyles: options.hairStyles,
    facialHair: options.facialHair,
    headwear: options.headwear,
    eyewear: options.eyewear,
    ears: options.ears,
    outfits: options.outfits,
    bodies: options.bodies,
    heights: options.heights,
  }

  it.each(Object.entries(categories))(
    '%s: a known key, a name with no digits, unique',
    (_c, list) => {
      const names = list.map((option) => strings[option.nameKey])
      for (const [i, name] of names.entries()) {
        expect(name, list[i]?.nameKey).toBeDefined()
        expect(name, list[i]?.nameKey).not.toMatch(/\d/)
      }
      expect(new Set(names).size).toBe(names.length)
    },
  )

  it('colour names use no food words (HUMAN REVIEW: skin-tone names)', () => {
    const swatches = [...options.skinTones, ...options.hairColors, ...options.garmentColors]
    for (const swatch of swatches) expect(strings[swatch.nameKey], swatch.id).not.toMatch(FOOD)
  })

  it('no model swatch or decor colour name is a food word either (HUMAN REVIEW)', () => {
    const swatchKeys = Object.keys(strings).filter(
      (key) => key.startsWith('models.color.') || /^colors\.\w+\.name$/.test(key),
    )
    expect(swatchKeys.length).toBeGreaterThan(20)
    expect(swatchKeys.filter((key) => FOOD.test(strings[key] ?? ''))).toEqual([])
  })
})

describe('items look (D12)', () => {
  const wearables = items.filter((item) => item.slot !== undefined)

  it('every wearable names options and models that exist', () => {
    const has = (list: readonly { id: string }[], id: string) => list.some((o) => o.id === id)
    for (const item of wearables) {
      const look = item.look
      expect(look, item.id).toBeDefined()
      if (look?.part === 'outfit') {
        expect(has(options.outfits, look.outfit), item.id).toBe(true)
        // Worn by either body (S16b): an outfit item needs both variants.
        const outfit = options.outfits.find((o) => o.id === look.outfit)
        for (const body of options.bodies) {
          expect(outfit?.variants[body.id], `${item.id} ${body.id}`).toBeDefined()
        }
        expect(has(options.garmentColors, look.top), item.id).toBe(true)
      }
      if (look?.part === 'bottom')
        expect(has(options.garmentColors, look.color), item.id).toBe(true)
      if (look?.part === 'shoes') expect(options.shoeColors, item.id).toContain(look.color)
      if (look?.part === 'attachment') {
        expect(modelIds.has(look.model) || compat.pending.includes(look.model), item.id).toBe(true)
      }
    }
  })

  it('makeup has no visual yet (Q6)', () => {
    for (const item of wearables.filter((entry) => entry.slot === 'face')) {
      expect(item.look, item.id).toEqual({ part: 'none' })
    }
  })
})

describe('traits (D16) and their copy (GR-10)', () => {
  it('are 8, each effect within ±10% (the cap)', () => {
    expect(traits.traits).toHaveLength(8)
    expect(traits.maxModifierPct).toBe(10)
    expect(creatorConfig.traits).toEqual(traits)
    expect(Object.keys(engineConfig.traits.effects)).toEqual(traits.traits.map((t) => t.id))
  })

  it('every trait renders its name, flavour and one line per effect, numbers from data', () => {
    for (const trait of traits.traits) {
      expect(traitName(trait.id)).not.toBe('')
      expect(traitFlavor(trait.id)).not.toBe('')
      const lines = traitEffectLines(trait.id)
      expect(lines).toHaveLength(trait.effects.length)
      for (const [i, effect] of trait.effects.entries()) {
        expect(lines[i], trait.id).toContain(String(Math.abs(effect.pct)))
        expect(placeholdersOf(strings[traitEffectKey(effect.kind, effect.pct)] ?? '')).toEqual([
          'pct',
        ])
      }
    }
  })

  it('a buy/sell loop never makes cash, even at the best discount with the founder resale bonus', () => {
    const founderPts = Math.max(
      0,
      ...Object.values(balance.career.paths).map((p) =>
        p.bonus.kind === 'resale-pts' ? p.bonus.pts : 0,
      ),
    )
    for (const item of shopItems(engineConfig)) {
      const cheapest = scaleByPct(item.price, -traits.maxModifierPct)
      expect(resaleValue(item, 0, 0, engineConfig, founderPts), item.id).toBeLessThan(cheapest)
    }
  })
})

describe('career paths (DEC-20) and the creator (D18)', () => {
  it('four paths, each with a name, goal line and a bonus line built from its numbers', () => {
    expect(Object.keys(balance.career.paths)).toEqual([...CAREER_PATHS])
    for (const path of CAREER_PATHS) {
      expect(careerName(path)).not.toBe('')
      expect(careerGoalLine(path)).not.toBe('')
      const { bonus } = balance.career.paths[path]
      const amount = bonus.kind === 'resale-pts' ? bonus.pts : bonus.pct
      expect(careerBonusLine(path), path).toContain(String(amount))
    }
  })

  it('bonuses touch flex and event clout, home clout or resale only (never club, grant, premium or item)', () => {
    for (const path of Object.values(balance.career.paths)) {
      if (path.bonus.kind === 'clout-pct') expect(['flex', 'event']).toContain(path.bonus.source)
    }
    expect(balance.career.paths.streamer.bonus).toMatchObject({ exceptEventTags: ['nightlife'] })
  })

  it('the steps run Look, Traits, Dream, Neighborhood, Home; the origin seam is off (S44)', () => {
    expect(creator.steps.map((step) => step.id)).toEqual([
      'look',
      'traits',
      'dream',
      'origin',
      'neighborhood',
      'home',
    ])
    expect(creatorSteps(creatorConfig)).toEqual(['look', 'traits', 'dream', 'neighborhood', 'home'])
    expect(creator.steps.find((step) => step.id === 'traits')).toMatchObject({ pick: 2 })
    expect(creator.rolls).toEqual({ neighborhood: { scope: 'save' } })
    expect(creator.changeCooldownGameDays).toBe(7)
  })

  it('every neighborhood name renders from its id', () => {
    for (const id of engineConfig.neighborhoods) expect(neighborhoodName(id)).not.toBe('')
  })
})

describe('creator copy is generated, never hard-coded (GR-10)', () => {
  const prefixes = ['avatar.', 'creator.', 'career.', 'neighborhoods.', 'colors.hair.']
  const keys = Object.keys(strings).filter((key) => prefixes.some((p) => key.startsWith(p)))

  it('no string holds a literal number: amounts come in through placeholders', () => {
    const literal = keys.filter((key) => /\d/.test((strings[key] ?? '').replace(/\{\w+\}/g, '')))
    expect(literal).toEqual([])
  })

  it('every key the data names exists', () => {
    const named = [
      ...Object.values(options)
        .filter(Array.isArray)
        .flat()
        .flatMap((o) => (typeof o === 'object' && o !== null && 'nameKey' in o ? [o.nameKey] : [])),
      ...traits.traits.flatMap((t) => [t.nameKey, t.flavorKey]),
      ...Object.keys(balance.career.paths).flatMap((id) => {
        const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        return ['name', 'goal', 'bonus'].map((part) => `career.${camel}.${part}`)
      }),
    ]
    expect(named.filter((key) => strings[key as string] === undefined)).toEqual([])
  })
})
