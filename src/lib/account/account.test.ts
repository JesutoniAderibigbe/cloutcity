import { describe, expect, it } from 'vitest'
import { afterLoginDestination } from './afterLogin'
import { looksLikeEmail, usernameOf } from './identifier'
import { maskEmail } from './mask'

describe('the log-in identifier (DEC-61)', () => {
  it('reads an email when something comes before an @, else a username', () => {
    expect(looksLikeEmail('jo@example.test')).toBe(true)
    expect(looksLikeEmail(' jo@example.test ')).toBe(true)
    expect(looksLikeEmail('@claude_qa')).toBe(false)
    expect(looksLikeEmail('claude_qa')).toBe(false)
    expect(looksLikeEmail('a b@c.d')).toBe(false)
  })

  it('drops a leading @ and spaces from a username', () => {
    expect(usernameOf('  @@claude_qa ')).toBe('claude_qa')
    expect(usernameOf('claude_qa')).toBe('claude_qa')
  })
})

describe('after logging in (DEC-62)', () => {
  it('a conflict goes to the cloud sheet first; else the creator or the room', () => {
    expect(afterLoginDestination('conflict', true)).toBe('cloud')
    expect(afterLoginDestination('conflict', false)).toBe('cloud')
    expect(afterLoginDestination('synced', true)).toBe('home')
    expect(afterLoginDestination('synced', false)).toBe('creator')
    expect(afterLoginDestination('offline', true)).toBe('home')
  })
})

describe('maskEmail (S19)', () => {
  it('shows the first letter and the domain only', () => {
    expect(maskEmail('jordan@gmail.com')).toBe('j•••@gmail.com')
    expect(maskEmail('a@b.co')).toBe('a•••@b.co')
    expect(maskEmail('no-at-sign')).toBe('•••')
    expect(maskEmail('@b.co')).toBe('•••')
  })
})
