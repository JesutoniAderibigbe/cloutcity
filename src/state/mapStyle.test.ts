import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scene } from '@/lib/data/config'

/** A minimal in-memory Web Storage, standing in for window.localStorage. */
const data = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  clear: () => data.clear(),
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('window', { localStorage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('map style store (S04m)', () => {
  it("defaults to scene.json's style until the player picks one", async () => {
    const { mapStyleChoice } = await import('./mapStyle')
    expect(mapStyleChoice()).toBeNull()
    // The store's own fallback before the map registers its default matches scene.json.
    expect(scene.mapStyles.default).toBe('game')
  })

  it('persists a choice in the stores’ { state, version } shape and reads it back', async () => {
    const { MAP_STYLE_KEY, setMapStyle } = await import('./mapStyle')
    setMapStyle('real')
    expect(JSON.parse(localStorage.getItem(MAP_STYLE_KEY) ?? 'null')).toEqual({
      state: { style: 'real' },
      version: 1,
    })
    vi.resetModules()
    const fresh = await import('./mapStyle')
    expect(fresh.mapStyleChoice()).toBe('real')
  })

  it('treats anything but a known style as no choice', async () => {
    for (const raw of ['nope', '{"state":{"style":"neon"},"version":1}', 'null', '[]']) {
      vi.resetModules()
      localStorage.setItem('cloutcity:map-style', raw)
      const { mapStyleChoice } = await import('./mapStyle')
      expect(mapStyleChoice(), raw).toBeNull()
    }
  })

  it('keeps a choice for the session when storage throws', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    })
    const { mapStyleChoice, setMapStyle } = await import('./mapStyle')
    expect(mapStyleChoice()).toBeNull()
    setMapStyle('real')
    expect(mapStyleChoice()).toBe('real')
  })
})
