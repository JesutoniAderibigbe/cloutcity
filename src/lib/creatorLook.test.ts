import { describe, expect, it } from 'vitest'
import swatches from '@data/avatar/swatches.derived.json'
import { LOOK_FIELDS, lookProblem } from '@/engine/appearance'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { isCopyKey } from './copy'
import '@/lib/copy/ns/avatar'
import '@/lib/copy/ns/colors'
import '@/lib/copy/ns/creator'
import { FIELD_LEGEND, LOOK_CATEGORIES, hairHiddenBy, lookChoices, withChoice } from './creatorLook'

const options = creatorConfig.options
const base = engineConfig.avatar.defaults

describe('the Look step as data (S16a, GR-12)', () => {
  it('has the five categories, and every look field in exactly one of them', () => {
    expect(LOOK_CATEGORIES.map((category) => category.id)).toEqual([
      'hair',
      'facialHair',
      'accessories',
      'skin',
      'outfit',
    ])
    const fields = LOOK_CATEGORIES.flatMap((category) => [...category.fields])
    expect([...fields].sort()).toEqual([...LOOK_FIELDS].sort())
    expect(new Set(fields).size).toBe(fields.length)
  })

  it('keeps each category to its own parts: hair styles in Hair, coverings in Accessories', () => {
    const where = (field: string) =>
      LOOK_CATEGORIES.find((category) => (category.fields as readonly string[]).includes(field))?.id
    expect(where('hairStyle')).toBe('hair')
    expect(where('facialHair')).toBe('facialHair')
    for (const field of ['headwear', 'eyewear', 'ears']) expect(where(field)).toBe('accessories')
    expect(where('skin')).toBe('skin')
    for (const field of ['outfit', 'top', 'bottom', 'shoes', 'height']) {
      expect(where(field)).toBe('outfit')
    }
  })

  it('offers exactly the options data, every legend and name a copy key', () => {
    for (const field of LOOK_FIELDS) {
      expect(isCopyKey(FIELD_LEGEND[field]), field).toBe(true)
      const choices = lookChoices(field, base, options)
      expect(choices.length, field).toBeGreaterThan(0)
      for (const choice of choices) {
        expect(isCopyKey(choice.nameKey), `${field}:${choice.id}`).toBe(true)
        expect(lookProblem(withChoice(base, field, choice.id, options), engineConfig)).toBeNull()
      }
    }
    expect(lookChoices('skin', base, options)).toHaveLength(options.skinTones.length)
    expect(lookChoices('hairStyle', base, options)).toHaveLength(options.hairStyles.length)
    expect(lookChoices('shoes', base, options).map((c) => c.id)).toEqual(options.shoeColors)
  })

  it('paints every swatch from the derived colours (A11Y-1 names come with it)', () => {
    const colors: Record<string, string> = swatches.colors
    for (const field of LOOK_FIELDS) {
      for (const choice of lookChoices(field, base, options)) {
        if (choice.token !== undefined) {
          expect(colors[choice.token], `${field}:${choice.id}`).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  it('a hairstyle that offers only some hair colours moves the draft to one of them', () => {
    for (const style of options.hairStyles) {
      for (const color of options.hairColors) {
        const look = withChoice({ ...base, hairColor: color.id }, 'hairStyle', style.id, options)
        expect(lookProblem(look, engineConfig), `${style.id} ${color.id}`).toBeNull()
      }
    }
  })

  it('names the covering that hides the hair', () => {
    expect(hairHiddenBy(base, options)).toBeUndefined()
    expect(hairHiddenBy({ ...base, headwear: 'hijab' }, options)?.id).toBe('hijab')
  })
})
