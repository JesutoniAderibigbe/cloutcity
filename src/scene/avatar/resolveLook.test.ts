/** resolveLook (S16a): the drawn look as ModelRefs and hex colours, with part A0 pending. */
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
  it('maps the default look to its head and body, colouring only slots each model has', () => {
    const resolved = resolve(base)
    expect(hexOf(options.skinTones, base.skin)).toMatch(/^#[0-9a-f]{6}$/)
    const style = options.hairStyles.find((s) => s.id === base.hairStyle)
    const outfit = options.outfits.find((o) => o.id === base.outfit)
    expect(resolved.parts.head.id).toBe(style?.head)
    expect(resolved.parts.body.id).toBe(outfit?.body)
    expect(resolved.parts.rig.id).toBe('avatar-rig')
    expect(resolved.parts.attachments).toEqual([])
    expect(resolved.colors.head).toEqual({
      skin: hexOf(options.skinTones, base.skin),
      hair: hexOf(options.hairColors, base.hairColor),
    })
    // No shoes slot on the bodies until part A0: shoes are left out, never thrown on.
    expect(resolved.colors.body).toEqual({
      skin: hexOf(options.skinTones, base.skin),
      top: hexOf(options.garmentColors, base.top),
      bottom: hexOf(options.garmentColors, base.bottom),
    })
    expect(resolved.tint.top).toBe(hexOf(options.garmentColors, base.top))
    expect(resolved.heightM).toBe(resolved.parts.head.bounds?.max[1])
    expect(resolved.missing).toEqual([])
  })

  it('places the Kenney accessories at their scene.json joints, the hearing aid in the skin tone', () => {
    const resolved = resolve({ ...base, eyewear: 'glasses', ears: 'hearing-aid' })
    expect(resolved.parts.attachments?.map((a) => [a.ref.id, a.joint, a.offset])).toEqual([
      ['glasses', 'head', avatarRefs.attachments.glasses?.offset],
      ['hearing-aid', 'head', avatarRefs.attachments['hearing-aid']?.offset],
    ])
    expect(resolved.parts.attachments?.[1]?.colors).toEqual({
      shell: hexOf(options.skinTones, base.skin),
    })
  })

  it('a look that needs part A0 still draws: the default head stands in and the rest is listed', () => {
    const resolved = resolve({
      ...base,
      hairStyle: 'afro',
      facialHair: 'stubble',
      eyewear: 'sunglasses',
    })
    const fallback = options.hairStyles.find((s) => s.id === base.hairStyle)?.head
    expect(resolved.parts.head.id).toBe(fallback)
    expect(resolved.parts.attachments?.map((a) => a.ref.id)).toEqual(['sunglasses'])
    expect(resolved.missing).toEqual(['head-base', 'hair-afro', 'facial-stubble'])
  })

  it('leaves out a colour whose token the palette lacks (the A0 skin tones)', () => {
    const resolved = resolve({ ...base, skin: 'tone-01' })
    expect(resolved.colors.head?.skin).toBeUndefined()
    expect(resolved.colors.head?.hair).toBeDefined()
  })

  it('worn items win: a top sets the body and the capsule tint', () => {
    const resolved = resolve(base, ['bodega-graphic-tee', 'cargo-pants'])
    expect(resolved.parts.body.id).toBe('body-female-c')
    expect(resolved.colors.body?.top).toBe(hexOf(options.garmentColors, 'white'))
    expect(resolved.colors.body?.bottom).toBe(hexOf(options.garmentColors, 'moss'))
    expect(resolved.tint.top).toBe(hexOf(options.garmentColors, 'white'))
  })

  it('repairs ids it does not know before resolving (an older build, another player)', () => {
    const resolved = resolveAvatar({ look: { ...base, outfit: 'outfit-99' }, worn: ['nope'] })
    expect(resolved.parts.body.id).toBe(options.outfits.find((o) => o.id === base.outfit)?.body)
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
  const eyewear = ['none', 'glasses', 'sunglasses'][seed % 3] ?? 'none'
  const ears = seed % 2 === 0 ? 'none' : 'hearing-aid'
  return { eyewear, ears }
}
