/**
 * INT-7: landmark models (S07a) replace the real building under them, so district footprints
 * whose centroid falls inside a landmark's `exclusion` rectangle are dropped. The rectangles come
 * from data/landmarks/frames.derived.json when it exists; without it nothing is excluded.
 *
 * Only the `exclusion` of each frame is read; the rest of the file belongs to S07a. A file that
 * exists but does not match fails the build rather than silently excluding nothing.
 */
import { z } from 'zod'
import type { LocalPoint } from '../../src/lib/geo/projection.ts'

/** A rotated rectangle in local metres: centre, half extents, and the long axis's angle. */
export const LandmarkExclusionSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  halfLengthM: z.number().positive(),
  halfWidthM: z.number().positive(),
  /** Degrees counter-clockwise from east to the rectangle's length axis. */
  angleDeg: z.number(),
})
export type LandmarkExclusion = z.infer<typeof LandmarkExclusionSchema>

const FramesSchema = z.object({
  frames: z.array(z.object({ exclusion: LandmarkExclusionSchema.optional() })),
})

export const FRAMES_PATH = 'landmarks/frames.derived.json'

/** The exclusion rectangles of a parsed frames file, or none when there is no file. */
export function readLandmarkExclusions(json: unknown): LandmarkExclusion[] {
  if (json === undefined) return []
  const result = FramesSchema.safeParse(json)
  if (!result.success) {
    throw new Error(`Invalid data/${FRAMES_PATH} (INT-7):\n${z.prettifyError(result.error)}`)
  }
  return result.data.frames.flatMap((frame) => (frame.exclusion ? [frame.exclusion] : []))
}

export function insideExclusion(point: LocalPoint, rect: LandmarkExclusion): boolean {
  const angle = (rect.angleDeg * Math.PI) / 180
  const dx = point.x - rect.x
  const dy = point.y - rect.y
  const along = dx * Math.cos(angle) + dy * Math.sin(angle)
  const across = -dx * Math.sin(angle) + dy * Math.cos(angle)
  return Math.abs(along) <= rect.halfLengthM && Math.abs(across) <= rect.halfWidthM
}

export const insideAnyExclusion = (point: LocalPoint, rects: readonly LandmarkExclusion[]) =>
  rects.some((rect) => insideExclusion(point, rect))
