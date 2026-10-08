import { describe, expect, it } from 'vitest'
import compat from '@data/avatar/compat.json'
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
  it('has the six categories (S16b: Body first), and every look field in exactly one', () => {
    expect(LOOK_CATEGORIES.map((category) => category.id)).toEqual([
      'body',
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
    expect(where('body')).toBe('body')
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
    // Pending styles (S16b P2a) are not offered yet.
    const pendingStyles = options.hairStyles.filter(
      (style) =>
        style.piece !== undefined && (compat.pending as readonly string[]).includes(style.piece),
    )
    expect(lookChoices('hairStyle', base, options)).toHaveLength(
      options.hairStyles.length - pendingStyles.length,
    )
    expect(lookChoices('body', base, options).map((c) => c.nameKey)).toEqual([
      'avatar.body.woman',
      'avatar.body.man',
    ])
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

  it('offers each body only its outfits, and a body switch keeps the outfit valid', () => {
    const woman = lookChoices('outfit', { ...base, body: 'woman' }, options).map((c) => c.id)
    const man = lookChoices('outfit', { ...base, body: 'man' }, options).map((c) => c.id)
    expect(woman).toContain('dress')
    expect(woman).not.toContain('hoodie')
    expect(man).toContain('hoodie')
    expect(man).not.toContain('dress')
    const dressed = { ...base, body: 'woman', outfit: 'dress' }
    const switched = withChoice(dressed, 'body', 'man', options)
    expect(switched.outfit).not.toBe('dress')
    expect(lookProblem(switched, engineConfig)).toBeNull()
  })

  it('names the covering that hides the hair', () => {
    expect(hairHiddenBy(base, options)).toBeUndefined()
    expect(hairHiddenBy({ ...base, headwear: 'hijab' }, options)?.id).toBe('hijab')
  })
})
