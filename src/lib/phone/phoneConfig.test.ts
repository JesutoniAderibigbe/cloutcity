import { describe, expect, it } from 'vitest'
import phoneCopy from '@data/copy/phone/base.json'
import { PHONE_APP_IDS } from '@/lib/data/schemas/config'
import {
  PHONE_APP_TARGETS,
  SHORTCUTS_SCREEN,
  badgeCount,
  phoneAppOf,
  phoneConfig,
} from './phoneConfig'

const keys = new Set(Object.keys(phoneCopy.strings))

describe('phone config (S58)', () => {
  it('names a label for every app and copy for every help question and shortcut', () => {
    for (const id of PHONE_APP_IDS) expect(PHONE_APP_TARGETS[id]).toBeDefined()
    for (const { id } of phoneConfig.apps) expect(keys.has(`phone.app.${id}`), id).toBe(true)
    for (const id of phoneConfig.help.faq) {
      expect(keys.has(`phone.help.faq.${id}.q`), id).toBe(true)
      expect(keys.has(`phone.help.faq.${id}.a`), id).toBe(true)
    }
    for (const id of phoneConfig.help.shortcuts) {
      expect(keys.has(`phone.keys.${id}.keys`), id).toBe(true)
      expect(keys.has(`phone.keys.${id}.does`), id).toBe(true)
    }
  })

  it('maps a requested screen to its app; shortcuts belong to Settings & Help', () => {
    expect(phoneAppOf(null)).toBeNull()
    expect(phoneAppOf('bank')).toBe('bank')
    expect(phoneAppOf(SHORTCUTS_SCREEN)).toBe('settings')
    expect(phoneAppOf('nope')).toBeNull()
  })

  it('caps the badge instead of flooding (GR-21)', () => {
    const cap = phoneConfig.updates.badgeCap
    expect(badgeCount(0, cap)).toBeNull()
    expect(badgeCount(cap, cap)).toEqual({ capped: false, value: cap })
    expect(badgeCount(cap + 90, cap)).toEqual({ capped: true, value: cap })
  })
})
