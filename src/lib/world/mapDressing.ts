/**
 * What the game map style's lazy chunks read for themselves (S04m), so none of it rides in the
 * page's payload (the shell's inline bytes): theme world colours by token, the homes' points and
 * the area names with their copy. Client code for lazy chunks only (the plots, the buildings
 * layer and the pin marks); the JSON is validated by src/lib/data/data.test.ts, which gates every
 * build, so it is typed with a cast here instead of parsed (the classic-zod loader must stay out
 * of client chunks).
 */
import themeJson from '@data/config/theme.json'
import homesJson from '@data/homes/homes.json'
import areaLabelsJson from '@data/places/areaLabels.json'
import { copy, isCopyKey } from '@/lib/copy'
import { project, type LocalPoint } from '@/lib/geo/projection'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/map'

const world: Readonly<Record<string, string>> = { ...themeJson.world, ...themeJson.models }

/** The hex of a theme world (or model) token; unknown tokens throw (a config typo). */
export function worldHex(token: string): string {
  const hex = world[token]
  if (hex === undefined) throw new Error(`theme.json: unknown world token "${token}"`)
  return hex
}

/** Every home (data/homes/homes.json) in local metres, rounded like the geo layers. */
export function homePoints(): { readonly id: string; readonly x: number; readonly y: number }[] {
  return Object.entries(homesJson.homes).map(([id, home]) => {
    const point: LocalPoint = project(home.location)
    return { id, x: Math.round(point.x), y: Math.round(point.y) }
  })
}

/** One area name (data/places/areaLabels.json) in local metres, its text from copy. */
export interface AreaName {
  readonly text: string
  readonly kind: 'water' | 'neighborhood'
  readonly x: number
  readonly y: number
  readonly angleDeg: number
}

export function areaNames(): AreaName[] {
  return areaLabelsJson.labels.map((label) => {
    if (!isCopyKey(label.nameKey)) throw new Error(`areaLabels.json: no copy "${label.nameKey}"`)
    const point = project(label.location)
    return {
      text: copy(label.nameKey),
      kind: label.kind === 'water' ? 'water' : 'neighborhood',
      x: Math.round(point.x),
      y: Math.round(point.y),
      angleDeg: label.angleDeg,
    }
  })
}
