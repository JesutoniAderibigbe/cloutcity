import { describe, expect, it } from 'vitest'
import { entryViewFor, viewWithPick } from './WelcomeGate'

describe('the entry gate (DEC-62)', () => {
  it('with accounts: the landing until signed in, then the welcome steps, then play', () => {
    expect(entryViewFor('welcome', false, true)).toBe('landing')
    expect(entryViewFor('done', false, true)).toBe('landing')
    expect(entryViewFor('welcome', true, true)).toBe('finish')
    expect(entryViewFor('done', true, true)).toBe('open')
    expect(entryViewFor('done', undefined, true)).toBe('pending')
  })

  it('an under-age lock holds whatever else is true', () => {
    expect(entryViewFor('locked', true, true)).toBe('locked')
    expect(entryViewFor('locked', false, false)).toBe('locked')
  })

  it('without accounts in the build: the welcome card, then solo play', () => {
    expect(entryViewFor('welcome', undefined, false)).toBe('welcome')
    expect(entryViewFor('done', false, false)).toBe('open')
    expect(entryViewFor('pending', true, true)).toBe('pending')
  })

  it('a picked screen stays until its last step, even once the account signs in', () => {
    expect(viewWithPick('landing', null)).toBe('landing')
    expect(viewWithPick('landing', 'signup')).toBe('signup')
    expect(viewWithPick('finish', 'login')).toBe('login')
    expect(viewWithPick('open', 'login')).toBe('login')
    expect(viewWithPick('open', null)).toBe('open')
    // An under-age answer locks over it.
    expect(viewWithPick('locked', 'signup')).toBe('locked')
  })
})
