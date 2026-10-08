/**
 * The LION street chains (/geo/streets?v=<hash>, S04i) for every client that needs them: the
 * street props and the living city (S04l). One fetch and one validation per URL for the page's
 * life, whichever asks first; a failed load is forgotten so a later ask (back online) retries.
 * Never warmed or precached: the service worker caches it at runtime.
 */
import { StreetsMiniSchema, type StreetsMini } from '../props/schema'

export type FetchJson = (url: string) => Promise<unknown>

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as unknown
}

const loads = new Map<string, Promise<StreetsMini>>()

async function fetchStreets(url: string, fetchJson: FetchJson): Promise<StreetsMini> {
  const parsed = StreetsMiniSchema.safeParse(await fetchJson(url))
  if (!parsed.success) throw new Error('invalid streets file')
  return parsed.data
}

/**
 * The validated streets file at `url`. A caller passing its own `fetchJson` (tests) gets its
 * own load, outside the shared cache.
 */
export function loadStreets(url: string, fetchJson?: FetchJson): Promise<StreetsMini> {
  if (fetchJson !== undefined) return fetchStreets(url, fetchJson)
  let load = loads.get(url)
  if (load === undefined) {
    load = fetchStreets(url, defaultFetchJson)
    loads.set(url, load)
    load.catch(() => {
      if (loads.get(url) === load) loads.delete(url)
    })
  }
  return load
}
