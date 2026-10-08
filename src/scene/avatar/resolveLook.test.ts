/** resolveLook (S16a, S16b frames): the drawn look as ModelRefs and hex colours. */
import { describe, expect, it } from 'vitest'
import { publicAvatar, type Look } from '@/engine/appearance'
import { effectiveLook } from '@/engine/avatarLook'
import { engineConfig as config } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { avatarRefs, resolveAvatar } from './LookAvatar'
import { resolveLook } from './resolveLook'

const options = creatorConfig.options
const base: Look = config.avatar.defaults
const hexOf = (list: readonly { id: string; token: string }[], id: string) =>
  avatarRefs.colors[list.find((option) => option.id === id)?.token ?? '']
const resolve = (look: Look, worn: readonly string[] = []) => resolveAvatar({ look, worn })

describe('resolveLook', () => {
  it('maps the default look to its frame’s rig, face and outfit, colouring only slots each has', () => {
    const resolved = resolve(base)
    const frame = options.bodies.find((body) => body.id === base.body)
    const outfit = options.outfits.find((o) => o.id === base.outfit)
    expect(resolved.parts.rig.id).toBe(frame?.rig)
    expect(resolved.parts.head.id).toBe(frame?.head)
    expect(resolved.parts.body.id).toBe(outfit?.variants[base.body])
    // Under a hair piece the woman frame's cap is its hair cap (S04p), in the hair colour.
    expect(resolved.parts.attachments?.map((a) => a.ref.id)).toEqual(['scalp-cap-f', 'hair-bob'])
    expect(resolved.colors.head).toEqual({
      skin: hexOf(options.skinTones, base.skin),
      hair: hexOf(options.hairColors, base.hairColor),
    })
    expect(resolved.colors.body).toEqual({
      skin: hexOf(options.skinTones, base.skin),
      top: hexOf(options.garmentColors, base.top),
      bottom: hexOf(options.garmentColors, base.bottom),
      shoes: hexOf(options.garmentColors, base.shoes),
    })
    expect(resolved.parts.attachments?.[0]).toMatchObject({
      joint: 'head',
      offset: [0, 0, 0],
      colors: { skin: hexOf(options.hairColors, base.hairColor) },
    })
    expect(resolved.parts.attachments?.[0]?.scale).toBeUndefined()
    expect(resolved.parts.attachments?.[1]).toMatchObject({
      joint: 'head',
      offset: [0, 0, 0],
      colors: { hair: hexOf(options.hairColors, base.hairColor) },
    })
    expect(resolved.tint.top).toBe(hexOf(options.garmentColors, base.top))
    expect(resolved.heightM).toBe(resolved.parts.head.bounds?.max[1])
    expect(resolved.missing).toEqual([])
  })

  it('the man frame takes its own rig, face and outfit variant', () => {
    const resolved = resolve({ ...base, body: 'man', outfit: 'suit', hairStyle: 'parted' })
    expect(resolved.parts.rig.id).toBe('avatar-rig-m')
    expect(resolved.parts.head.id).toBe('head-m')
    expect(resolved.parts.body.id).toBe('outfit-m-suit')
  })

  it('draws the refitted Blender attachments, nothing pending (S16b P2a)', () => {
    const resolved = resolve({ ...base, hairStyle: 'afro', eyewear: 'glasses' })
    expect(resolved.parts.attachments?.map((a) => a.ref.id)).toEqual([
      'scalp-cap-f',
      'hair-afro',
      'glasses',
    ])
    expect(resolved.missing).toEqual([])
  })

  it('a head covering hides the hair piece', () => {
    const drawn = effectiveLook(
      { look: { ...base, headwear: 'hijab' }, worn: [] },
      config,
      creatorConfig,
    )
    expect(drawn.attachments).not.toContain('hair-bob')
  })

  it('colours every skin tone', () => {
    for (const tone of options.skinTones) {
      const resolved = resolve({ ...base, skin: tone.id })
      expect(resolved.colors.head?.skin, tone.id).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('worn items win: a top sets the outfit and the capsule tint', () => {
    const resolved = resolve(base, ['bodega-graphic-tee', 'cargo-pants'])
    expect(resolved.parts.body.id).toBe('outfit-w-casual')
    expect(resolved.colors.body?.top).toBe(hexOf(options.garmentColors, 'white'))
    expect(resolved.colors.body?.bottom).toBe(hexOf(options.garmentColors, 'moss'))
    expect(resolved.tint.top).toBe(hexOf(options.garmentColors, 'white'))
  })

  it('repairs ids it does not know before resolving (an older build, another player)', () => {
    const resolved = resolveAvatar({ look: { ...base, outfit: 'outfit-99' }, worn: ['nope'] })
    expect(resolved.parts.body.id).toBe('outfit-w-casual')
    // A Kenney-era man's look keeps its frame through the legacy aliases.
    const legacy = { ...base, outfit: 'outfit-11', hairStyle: 'style-12' } as Record<string, string>
    delete legacy.body
    const man = resolveAvatar({ look: legacy as unknown as Look, worn: [] })
    expect([man.parts.rig.id, man.parts.body.id]).toEqual(['avatar-rig-m', 'outfit-m-hoodie'])
    expect(man.parts.attachments?.map((a) => a.ref.id)).toEqual(['scalp-cap-f', 'hair-parted'])
  })

  it('every hair piece covers the scalp on both frames: a hair cap in the hair colour (S04p)', () => {
    const hair = (look: Look) => hexOf(options.hairColors, look.hairColor)
    for (const body of options.bodies) {
      const cap = body.hairCap
      expect(cap, body.id).toBeDefined()
      for (const style of options.hairStyles.filter((s) => s.piece !== undefined)) {
        const look = { ...base, body: body.id, hairStyle: style.id, hairColor: 'pink' }
        const resolved = resolve(look)
        const ids = resolved.parts.attachments?.map((a) => a.ref.id) ?? []
        expect(ids.slice(0, 2), `${body.id} ${style.id}`).toEqual([cap?.model, style.piece])
        expect(resolved.parts.attachments?.[0]).toMatchObject({
          colors: { skin: hair(look) },
          offset: cap?.offset ?? [0, 0, 0],
        })
        expect(resolved.parts.attachments?.[0]?.scale).toEqual(cap?.scale)
      }
    }
  })

  it('a bald head keeps its skin: the woman wears her skin-toned scalp cap, the man none', () => {
    const woman = resolve({ ...base, hairStyle: 'shaved' })
    expect(woman.parts.attachments?.map((a) => a.ref.id)).toEqual(['scalp-cap-f'])
    expect(woman.parts.attachments?.[0]?.colors).toEqual({
      skin: hexOf(options.skinTones, base.skin),
    })
    expect(woman.parts.attachments?.[0]?.scale).toBeUndefined()
    const man = resolve({ ...base, body: 'man', outfit: 'suit', hairStyle: 'shaved' })
    expect(man.parts.attachments ?? []).toEqual([])
    // Under a covering the hair (and its cap) is hidden.
    const covered = resolve({ ...base, body: 'man', outfit: 'suit', headwear: 'beanie' })
    expect(covered.parts.attachments?.map((a) => a.ref.id)).toEqual(['headwear-beanie'])
  })

  it('carries the height option as the root scale', () => {
    expect(resolve({ ...base, height: 'tall' }).scale).toBe(1.04)
  })

  it('every look of every seed resolves, within four attachments', () => {
    for (let seed = 0; seed < 200; seed++) {
      const look = publicAvatar({
        look: { ...base, ...resolveSeed(seed) },
        inventory: { wearables: [], gifts: [], outfit: {}, decor: [] },
      })
      const drawn = effectiveLook(look, config, creatorConfig)
      const resolved = resolveLook(drawn, options, avatarRefs)
      expect(resolved.parts.attachments?.length ?? 0).toBeLessThanOrEqual(4)
    }
  })
})

function resolveSeed(seed: number): Partial<Look> {
  const body = seed % 2 === 0 ? 'woman' : 'man'
  const hairStyle = options.hairStyles[seed % options.hairStyles.length]?.id ?? 'bob'
  const eyewear = ['none', 'glasses', 'sunglasses'][seed % 3] ?? 'none'
  return { body, hairStyle, eyewear }
}
