/**
 * Client-side validation of the street chains street props stand on (S04i), fetched from
 * /geo/streets?v=<hash>. Mirrors StreetsFileSchema in src/lib/data/schemas/world.ts with
 * `zod/mini` (classic zod must not reach browser code); schema.test.ts runs the committed file
 * and malformed fixtures through both so they cannot drift apart.
 */
import * as z from 'zod/mini'
import { ORIGIN, PROJECTION_ID } from '@/lib/geo/projection'
import { STREET_SOURCE_IDS, STREET_ZONE_IDS } from '@/lib/geo/streetSources'

const metre = z.int()
const evenLength = z.refine<number[]>((coords) => coords.length % 2 === 0, 'odd coordinate count')

export const StreetsMiniSchema = z
  .strictObject({
    format: z.literal('cc-streets-v1'),
    derived: z.literal(true),
    notice: z.string().check(z.minLength(1)),
    sources: z.array(z.enum(STREET_SOURCE_IDS)).check(z.minLength(1)),
    projection: z.strictObject({
      id: z.literal(PROJECTION_ID),
      originLat: z.literal(ORIGIN.lat),
      originLng: z.literal(ORIGIN.lng),
    }),
    zones: z
      .array(
        z.strictObject({
          id: z.enum(STREET_ZONE_IDS),
          x: metre,
          y: metre,
          r: z.number().check(z.gt(0)),
        }),
      )
      .check(z.minLength(1)),
    clear: z.array(z.strictObject({ x: metre, y: metre, r: z.number().check(z.gt(0)) })),
    chains: z.strictObject({
      n: z.array(z.int().check(z.gte(2))),
      p: z.array(metre).check(evenLength),
      w: z.array(
        z.number().check(
          z.gt(0),
          z.refine((w) => Number.isInteger(w * 2), 'half-width to 0.5 m'),
        ),
      ),
      j: z.array(z.int().check(z.gte(0))),
      e: z.array(z.int().check(z.gte(0), z.lte(7))),
    }),
  })
  .check(
    z.refine(
      ({ chains }) =>
        chains.w.length === chains.n.length &&
        chains.e.length === chains.n.length &&
        chains.p.length === 2 * chains.n.reduce((sum, n) => sum + n, 0),
      'n, w and e need one entry per chain, and p one point per vertex',
    ),
    z.refine(({ chains }) => {
      const vertices = chains.n.reduce((sum, n) => sum + n, 0)
      let at = 0
      return chains.j.every((delta, i) => {
        at += delta
        return (i === 0 || delta > 0) && at < vertices
      })
    }, 'junction indices must ascend and stay inside the path'),
  )
export type StreetsMini = z.infer<typeof StreetsMiniSchema>
