import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGeoBase } from './load'

afterEach(() => {
  vi.unstubAllGlobals()
})

let n = 0
/** A fresh URL per test: the loader caches one request per URL. */
const url = () => `/geo/base?v=test${++n}`

describe('loadGeoBase', () => {
  it('resolves the JSON body, and reuses one request per URL', async () => {
    const fetchMock = vi.fn(async () => Response.json({ format: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const target = url()
    expect(await loadGeoBase(target)).toEqual({ ok: true, body: { format: 'x' } })
    await loadGeoBase(target)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports an HTTP error, a network error and a non-JSON body without rejecting', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }))
    expect(await loadGeoBase(url())).toEqual({
      ok: false,
      failure: { reason: 'geo-http', status: 500 },
    })

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await loadGeoBase(url())).toEqual({ ok: false, failure: { reason: 'geo-network' } })

    vi.stubGlobal('fetch', async () => new Response('{"format":', { status: 200 }))
    expect(await loadGeoBase(url())).toEqual({ ok: false, failure: { reason: 'geo-json' } })
  })
})
