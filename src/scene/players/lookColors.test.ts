import optionsJson from '@data/avatar/options.json'
import swatchesJson from '@data/avatar/swatches.derived.json'
import { describe, expect, it } from 'vitest'
import { copy, isCopyKey } from '@/lib/copy'
import '@/lib/copy/all'
import { lookColours } from './lookColors'

const hexOf = (token: string) => (swatchesJson.colors as Record<string, string>)[token]

describe('lookColours', () => {
  it('resolves a look through the options and swatches', () => {
    const colours = lookColours({
      body: 'man',
      skin: 'tone-01',
      top: 'red',
      bottom: 'navy',
      hairColor: 'blonde',
    })
    expect(colours.body).toBe('man')
    expect(colours.skin.hex).toBe(hexOf('skin-050'))
    expect(colours.top.hex).toBe(hexOf('red-600'))
    expect(colours.bottom.hex).toBe(hexOf('navy-800'))
    expect(colours.hair.hex).toBe(hexOf('hair-100'))
  })

  it('falls back to the creator defaults for a missing or unknown look', () => {
    const d = optionsJson.defaults
    const fallback = lookColours(null)
    expect(fallback.body).toBe(d.body)
    expect(lookColours({ body: 'robot', top: 'plaid' })).toEqual({
      ...fallback,
      body: 'woman',
    })
  })

  it('names every colour it can return (A11Y-1/2)', () => {
    const lists = [
      optionsJson.skinTones.map((o) => ({ skin: o.id })),
      optionsJson.garmentColors.map((o) => ({ top: o.id, bottom: o.id })),
      optionsJson.hairColors.map((o) => ({ hairColor: o.id })),
    ].flat()
    for (const look of lists) {
      const c = lookColours(look)
      for (const s of [c.skin, c.top, c.bottom, c.hair]) {
        expect(s.hex).toMatch(/^#[0-9a-f]{6}$/i)
        expect(isCopyKey(s.nameKey), s.nameKey).toBe(true)
        expect(copy(s.nameKey)).not.toBe('')
      }
    }
  })
})
