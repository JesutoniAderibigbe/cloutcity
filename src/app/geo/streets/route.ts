/**
 * GET /geo/streets: the LION street chains street props stand on (S04i), prerendered at build
 * time (force-static). Only the props layer requests it, as /geo/streets?v=<content hash>
 * (src/lib/data/districts.ts streetsUrl), and only on mid and high once the camera zooms in;
 * the service worker caches it at runtime and never precaches or warms it (src/sw/policy.ts).
 */
import { readStreets } from '@/lib/data/districts'

export const dynamic = 'force-static'

export async function GET(): Promise<Response> {
  return Response.json(await readStreets())
}
