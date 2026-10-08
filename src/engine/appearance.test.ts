/** The look (S16a): random starts, repairs, what is drawn and what other players see. */
import { describe, expect, it } from 'vitest'
import { fnv1a, lookProblem, publicAvatar, randomLook, repairLook, type Look } from './appearance'
import { effectiveLook } from './avatarLook'
import { engineConfig as config } from './config'
import { creatorConfig } from './creatorConfig'
import { chooseLook } from './creatorFlow'
import { initialSnapshot, type PlayerState } from './game'
import type { Inventory } from './items'

const options = creatorConfig.options
const base: Look = config.avatar.defaults

/** A player wearing `worn` (item ids, each owned and worn in its slot) over `look`. */
function wearing(look: Look, worn: readonly string[]): Pick<PlayerState, 'look' | 'inventory'> {
  const outfit: Record<string, string> = {}
  for (const itemId of worn) {
    const item = config.items.catalog.find((entry) => entry.id === itemId)
    if (item === undefined || !('slot' in item)) throw new Error(`no wearable ${itemId}`)
    outfit[item.slot] = itemId
  }
  const inventory: Inventory = {
    wearables: worn.map((itemId) => ({ itemId, acquiredMinute: 0, worn: true })),
    gifts: [],
    outfit,
    decor: [],
  }
  return { look, inventory }
}

describe('randomLook', () => {
  it('is the same look for the same seed, and always a valid one', () => {
    for (let seed = 0; seed < 500; seed++) {
      const look = randomLook(seed, config)
      expect(randomLook(seed, config)).toEqual(look)
      expect(lookProblem(look, config), `seed ${seed}`).toBeNull()
    }
  })

  it('varies with the seed across every category', () => {
    const looks = Array.from({ length: 400 }, (_, seed) => randomLook(seed * 7919, config))
    for (const field of [
      'skin',
      'hairStyle',
      'hairColor',
      'outfit',
      'top',
      'bottom',
      'shoes',
    ] as const) {
      expect(new Set(looks.map((look) => look[field])).size, field).toBeGreaterThan(3)
    }
  })

  it('lands each extra at roughly its configured chance (TUNE-11)', () => {
    const n = 4000
    const looks = Array.from({ length: n }, (_, seed) => randomLook(fnv1a(`s${seed}`), config))
    const rate = (pick: (look: Look) => boolean) => looks.filter(pick).length / n
    expect(rate((l) => l.facialHair !== 'none')).toBeCloseTo(options.random.facialHair, 1)
    expect(rate((l) => l.eyewear !== 'none')).toBeCloseTo(options.random.eyewear, 1)
    expect(rate((l) => l.headwear !== 'none')).toBeCloseTo(options.random.headwear, 1)
    expect(rate((l) => l.ears !== 'none')).toBeCloseTo(options.random.hearingAid, 1)
  })

  it('dresses each body in an outfit it has (S16b)', () => {
    for (let seed = 0; seed < 300; seed++) {
      const look = randomLook(seed, config)
      expect(config.avatar.outfitsByBody[look.body]).toContain(look.outfit)
    }
    const bodies = new Set(Array.from({ length: 100 }, (_, seed) => randomLook(seed, config).body))
    expect([...bodies].sort()).toEqual(['man', 'woman'])
  })
})

describe('repairLook', () => {
  it('keeps a valid look untouched', () => {
    expect(repairLook(base, config)).toEqual({ look: base, repaired: false })
  })

  it.each([
    ['an unknown skin', { ...base, skin: 'tone-99' }, 'skin'],
    ['a hair colour of the wrong type', { ...base, hairColor: 7 }, 'hairColor'],
    ['a missing outfit', { ...base, outfit: undefined }, 'outfit'],
    ['a prototype key', { ...base, height: '__proto__' }, 'height'],
  ])('replaces %s with the default', (_label, raw, field) => {
    const { look, repaired } = repairLook(raw, config)
    expect(repaired).toBe(true)
    expect(look[field as keyof Look]).toBe(base[field as keyof Look])
    expect(lookProblem(look, config)).toBeNull()
  })

  it('drops unknown keys and turns anything that is not an object into the default look', () => {
    expect(repairLook({ ...base, admin: true }, config)).toEqual({ look: base, repaired: true })
    for (const raw of [null, 'look', 42, []]) {
      expect(repairLook(raw, config)).toEqual({ look: base, repaired: true })
    }
  })

  it('maps Kenney-era ids and derives the body from the old outfit (S16b, no save bump)', () => {
    const old = { ...base, hairStyle: 'style-12', outfit: 'outfit-11' } as Record<string, string>
    delete old.body
    const { look, repaired } = repairLook(old, config)
    expect(repaired).toBe(true)
    expect(look).toMatchObject({ body: 'man', hairStyle: 'parted', outfit: 'hoodie' })
    expect(repairLook(look, config)).toEqual({ look, repaired: false })
    const woman = repairLook({ ...old, outfit: 'outfit-02' }, config).look
    expect(woman).toMatchObject({ body: 'woman', outfit: 'casual' })
  })

  it('an outfit the body has no variant of becomes the default outfit', () => {
    const { look, repaired } = repairLook({ ...base, body: 'woman', outfit: 'hoodie' }, config)
    expect(repaired).toBe(true)
    expect(look.outfit).toBe(base.outfit)
    expect(lookProblem({ ...base, body: 'man', outfit: 'dress' }, config)).toBe('outfit')
  })
})

describe('effectiveLook', () => {
  const look: Look = { ...base, hairStyle: 'afro', headwear: 'none', facialHair: 'stubble' }

  it('draws the creator look with no items worn: the frame’s face, rig and outfit variant', () => {
    const drawn = effectiveLook(publicAvatar(wearing(look, [])), config, creatorConfig)
    expect(drawn.look).toEqual(look)
    expect(drawn.head).toBe('head-f')
    expect(drawn.rig).toBe('avatar-rig-f')
    expect(drawn.body).toBe('outfit-w-casual')
    // The woman frame always wears its scalp cap first (S16b), outside the attachment cap.
    expect(drawn.attachments).toEqual(['scalp-cap-f', 'hair-afro', 'facial-stubble'])
    const man = effectiveLook(
      publicAvatar(wearing({ ...look, body: 'man', outfit: 'hoodie' }, [])),
      config,
      creatorConfig,
    )
    expect([man.head, man.rig, man.body]).toEqual(['head-m', 'avatar-rig-m', 'outfit-m-hoodie'])
    expect(drawn.hairHidden).toBe(false)
    expect(drawn.scale).toBe(1)
  })

  it('a worn item wins over the creator choice: top, bottom, shoes and an accessory', () => {
    const drawn = effectiveLook(
      publicAvatar(
        wearing(look, ['bodega-graphic-tee', 'cargo-pants', 'canvas-sneakers', 'subway-tote']),
      ),
      config,
      creatorConfig,
    )
    expect(drawn.look).toMatchObject({
      outfit: 'casual',
      top: 'white',
      bottom: 'moss',
      shoes: 'white',
    })
    expect(drawn.body).toBe('outfit-w-casual')
    expect(drawn.attachments.at(-1)).toBe('acc-subway-tote')
    // The creator's own choices are kept underneath.
    expect(look.outfit).toBe(base.outfit)
  })

  it('makeup has no visual (Q6)', () => {
    expect(
      effectiveLook(publicAvatar(wearing(look, ['tinted-lip-balm'])), config, creatorConfig),
    ).toEqual(effectiveLook(publicAvatar(wearing(look, [])), config, creatorConfig))
  })

  it('a covering that hides hair hides the hair piece, keeping the style', () => {
    const covered: Look = { ...base, hairStyle: 'locs', headwear: 'hijab' }
    const drawn = effectiveLook(publicAvatar(wearing(covered, [])), config, creatorConfig)
    expect(drawn.hairHidden).toBe(true)
    expect(drawn.head).toBe('head-f')
    expect(drawn.attachments).toEqual(['scalp-cap-f', 'headwear-hijab'])
    expect(drawn.look.hairStyle).toBe('locs')
    const pack: Look = { ...base, hairStyle: 'bob', headwear: 'ballcap' }
    expect(
      effectiveLook(publicAvatar(wearing(pack, [])), config, creatorConfig).attachments,
    ).toEqual(['scalp-cap-f', 'headwear-ballcap'])
    expect(options.headwear.every((option) => option.id === 'none' || option.hidesHair)).toBe(true)
  })

  it('the woman frame always wears its scalp cap, outside the attachment cap', () => {
    expect(options.bodies.find((body) => body.id === 'woman')?.scalpCap).toBe('scalp-cap-f')
    expect(options.bodies.find((body) => body.id === 'man')?.scalpCap).toBeUndefined()
    for (const hairStyle of ['shaved', 'bob', 'buzz']) {
      const look = effectiveLook(
        publicAvatar(wearing({ ...base, body: 'woman', hairStyle }, [])),
        config,
        creatorConfig,
      )
      expect(look.attachments[0], hairStyle).toBe('scalp-cap-f')
    }
    const man = effectiveLook(
      publicAvatar(wearing({ ...base, body: 'man', hairStyle: 'shaved' }, [])),
      config,
      creatorConfig,
    )
    expect(man.attachments).not.toContain('scalp-cap-f')
  })

  it('the outdoors outfit hides the subway tote, which would clash with its backpack', () => {
    const outdoors = effectiveLook(
      publicAvatar(wearing({ ...base, outfit: 'outdoors' }, ['subway-tote'])),
      config,
      creatorConfig,
    )
    expect(outdoors.attachments).not.toContain('acc-subway-tote')
    const casual = effectiveLook(
      publicAvatar(wearing({ ...base, outfit: 'casual' }, ['subway-tote'])),
      config,
      creatorConfig,
    )
    expect(casual.attachments).toContain('acc-subway-tote')
  })

  it('keeps at most four attachments, in priority order: items go first', () => {
    const full: Look = {
      ...base,
      hairStyle: 'afro',
      headwear: 'ballcap',
      facialHair: 'goatee',
      eyewear: 'glasses',
      ears: 'hearing-aid',
    }
    const drawn = effectiveLook(publicAvatar(wearing(full, ['gold-hoops'])), config, creatorConfig)
    expect(options.attachments.max).toBe(4)
    // The cap hides the afro piece; the hoops (an item, last in priority) fall past the cap.
    expect(drawn.attachments).toEqual([
      'scalp-cap-f',
      'headwear-ballcap',
      'facial-goatee',
      'glasses',
      'hearing-aid',
    ])
  })

  it('the height option sets the root scale', () => {
    expect(
      effectiveLook(publicAvatar(wearing({ ...base, height: 'tall' }, [])), config, creatorConfig)
        .scale,
    ).toBe(1.04)
    expect(
      effectiveLook(publicAvatar(wearing({ ...base, height: 'short' }, [])), config, creatorConfig)
        .scale,
    ).toBe(0.96)
  })
})

describe('publicAvatar (D13)', () => {
  it('holds the look ids and the worn item ids only: enums, nothing else of the save', () => {
    const player = { ...initialSnapshot(config).player, ...wearing(base, ['cargo-pants']) }
    const shown = publicAvatar(player)
    expect(Object.keys(shown).sort()).toEqual(['look', 'worn'])
    expect(shown).toEqual({ look: base, worn: ['cargo-pants'] })
    const json = JSON.stringify(shown)
    expect(json).not.toMatch(/cash|clout|inventory|email|handle/i)
    for (const value of Object.values(shown.look)) expect(value).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('chooseLook', () => {
  const snapshot = initialSnapshot(config)

  it('sets a complete, valid look', () => {
    const look = randomLook(42, config)
    const result = chooseLook(snapshot, look, config)
    if (!result.ok) throw new Error(result.error.code)
    expect(result.snapshot.player.look).toEqual(look)
  })

  it.each([
    ['an unknown option', { ...base, skin: 'tone-99' }, 'skin'],
    ['a missing field', { ...base, height: undefined }, 'shape'],
    ['an extra field', { ...base, name: 'Ana' }, 'shape'],
    ['not an object', 'afro', 'shape'],
  ])('refuses %s (no free text, no repair)', (_label, raw, field) => {
    expect(chooseLook(snapshot, raw, config)).toEqual({
      ok: false,
      error: { code: 'INVALID_LOOK', field },
    })
  })
})

describe('fnv1a', () => {
  it('is the standard 32-bit FNV-1a', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('foobar')).toBe(0xbf9cf968)
  })
})
