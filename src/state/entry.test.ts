import { describe, expect, it } from 'vitest'
import { entryStore, setSignedIn, storedAccountSession } from './entry'

class MemoryStorage {
  private readonly map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const storage = (entries: Record<string, string>) => {
  const memory = new MemoryStorage()
  for (const [key, value] of Object.entries(entries)) memory.setItem(key, value)
  return memory as unknown as Storage
}

const session = (anonymous: boolean) =>
  JSON.stringify({ access_token: 'a', user: { id: 'u1', is_anonymous: anonymous } })

describe('is an account signed in on this device (DEC-62)', () => {
  it("reads supabase-js's session key without supabase-js", () => {
    expect(storedAccountSession(storage({ 'sb-abc-auth-token': session(false) }))).toBe(true)
  })

  it("a guest session from before DEC-62, the /mod console's session or junk does not count", () => {
    expect(storedAccountSession(storage({ 'sb-abc-auth-token': session(true) }))).toBe(false)
    expect(storedAccountSession(storage({ 'cloutcity-mod-auth': session(false) }))).toBe(false)
    expect(storedAccountSession(storage({ 'sb-abc-auth-token': '{not json' }))).toBe(false)
    expect(storedAccountSession(storage({ 'sb-abc-auth-token': '{}' }))).toBe(false)
    expect(storedAccountSession(storage({}))).toBe(false)
    expect(storedAccountSession(undefined)).toBe(false)
  })

  it('the signal starts unknown and follows sign-in and sign-out', () => {
    expect(entryStore.getState().signedIn).toBeUndefined()
    setSignedIn(true)
    expect(entryStore.getState().signedIn).toBe(true)
    setSignedIn(false)
    expect(entryStore.getState().signedIn).toBe(false)
  })
})
