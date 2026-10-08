import { describe, expect, it } from 'vitest'
import { StreetsMiniSchema } from '@/scene/props/schema'
import { GET, dynamic } from './route'

describe('GET /geo/streets (S04i)', () => {
  it('is prerendered and serves the chains the props layer validates', async () => {
    expect(dynamic).toBe('force-static')
    const response = await GET()
    const body = StreetsMiniSchema.parse(await response.json())
    expect(body.format).toBe('cc-streets-v1')
    expect(body.chains.n.length).toBeGreaterThan(0)
  })
})
