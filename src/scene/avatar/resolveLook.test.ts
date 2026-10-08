/** resolveLook (S16a): the drawn look as ModelRefs and hex colours. */
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
    expect(resolved.colors.body).toEqual({
      shoes: hexOf(options.garmentColors, base.shoes),
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

  it('a Blender piece on the bald head: facial hair takes the hair colour at the head joint', () => {
    const resolved = resolve({
      ...base,
      hairStyle: 'afro',
      hairColor: 'pink',
      facialHair: 'stubble',
      eyewear: 'sunglasses',
    })
    expect(resolved.parts.head.id).toBe('head-base')
    expect(resolved.colors.head).toEqual({ skin: hexOf(options.skinTones, base.skin) })
    const stubble = resolved.parts.attachments?.find((a) => a.ref.id === 'facial-stubble')
    expect(stubble).toMatchObject({ joint: 'head', offset: [0, 0, 0] })
    expect(stubble?.colors).toEqual({ hair: hexOf(options.hairColors, 'pink') })
    // The hair pieces wait on their avatar-hair cap (A0.3): drawn bald until then.
    expect(resolved.missing).toEqual(['hair-afro'])
  })

  it('an item attachment follows its catalog joint: the tote rides the torso', () => {
    const resolved = resolve({ ...base, top: 'navy' }, ['subway-tote', 'gold-hoops'])
    const joints = resolved.parts.attachments?.map((a) => [a.ref.id, a.joint])
    expect(joints).toEqual(
      expect.arrayContaining([
        ['acc-subway-tote', 'torso'],
        ['acc-gold-hoops', 'head'],
      ]),
    )
    const tote = resolved.parts.attachments?.find((a) => a.ref.id === 'acc-subway-tote')
    expect(tote?.colors).toEqual({ fabric: hexOf(options.garmentColors, 'navy') })
  })

  it('colours every skin tone, the A0 tones included', () => {
    for (const tone of options.skinTones) {
      const resolved = resolve({ ...base, skin: tone.id })
      expect(resolved.colors.head?.skin, tone.id).toMatch(/^#[0-9a-f]{6}$/)
    }
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
