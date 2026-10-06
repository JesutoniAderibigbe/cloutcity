/** Schemas for /data/geo, /data/zones and /data/audio. */
import { z } from 'zod'
import { BoroughSchema, IdSchema, listOf } from './content'

/** The NYC extent in WGS84 degrees: camera bounds and a sanity check for every coordinate. */
export const GeoBoundsSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
  })
  .refine((b) => b.west < b.east && b.south < b.north, { error: 'empty or inverted bounds' })
export type GeoBounds = z.infer<typeof GeoBoundsSchema>

/**
 * Play zones built from NYC Neighborhood Tabulation Areas. `name` is the NTA name from the
 * source data (a place name, not our copy).
 */
export const ZoneSchema = z.strictObject({
  id: IdSchema,
  ntaCode: z.string().regex(/^[A-Z]{2}\d{4}$/, 'NTA 2020 code, e.g. QN0101'),
  name: z.string().min(1),
  borough: BoroughSchema,
})
export const ZonesFileSchema = z.strictObject({ zones: listOf(ZoneSchema) })
export type Zone = z.infer<typeof ZoneSchema>

export const AUDIO_CHANNELS = ['music', 'sfx', 'ambience', 'voice'] as const

/** Music is CC0 only (no radio); every track records where it came from. */
export const AudioTrackSchema = z.strictObject({
  id: IdSchema,
  channel: z.enum(AUDIO_CHANNELS),
  /** Path under public/, e.g. `/audio/music/loop-1.ogg`. */
  file: z.string().regex(/^\/audio\/[a-z0-9/_-]+\.(?:ogg|mp3|m4a|webm)$/),
  license: z.literal('CC0-1.0'),
  sourceUrl: z.url({ protocol: /^https$/ }),
})
export const AudioManifestSchema = z.strictObject({
  channels: z.array(z.enum(AUDIO_CHANNELS)).length(AUDIO_CHANNELS.length),
  tracks: z.array(AudioTrackSchema),
})
export type AudioTrack = z.infer<typeof AudioTrackSchema>
