import { describe, expect, it, vi } from 'vitest'
import { handlePublicPresence, type PublicPresenceDeps } from './publicSnapshot'

const fresh = () => ({ at: -Infinity, body: { online: 0, figures: [] } })
const answer = {
  online: 3,
  figures: [
    { place: 'late-lantern-deli', borough: 'queens', look: { body: 'man', skin: 'tone-02' } },
    { place: 'NOT A PIN', borough: 'queens', look: {} },
  ],
}

function deps(read: PublicPresenceDeps['read'], now = 1_000_000): PublicPresenceDeps {
  return { read, now: () => now, cacheS: 15 }
}

describe('GET /api/presence', () => {
  it('answers the count and valid figures, cacheable by the CDN', async () => {
    const response = await handlePublicPresence(
      deps(() => Promise.resolve(answer)),
      fresh(),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('s-maxage=15')
    expect(await response.json()).toEqual({
      online: 3,
      figures: [
        { place: 'late-lantern-deli', borough: 'queens', look: { body: 'man', skin: 'tone-02' } },
      ],
    })
  })

  it('reads the database once per cache window', async () => {
    const cache = fresh()
    const read = vi.fn(() => Promise.resolve(answer))
    await handlePublicPresence(deps(read, 1_000_000), cache)
    await handlePublicPresence(deps(read, 1_010_000), cache)
    expect(read).toHaveBeenCalledTimes(1)
    await handlePublicPresence(deps(read, 1_016_000), cache)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('fails closed and uncached: no configuration, a failed read, a bad shape', async () => {
    for (const read of [
      null,
      () => Promise.reject(new Error('down')),
      () => Promise.resolve({ online: -1 }),
    ]) {
      const response = await handlePublicPresence(deps(read), fresh())
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})
