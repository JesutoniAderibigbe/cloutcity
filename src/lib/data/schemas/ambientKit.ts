/**
 * The `vehicleKit` block of data/config/ambient.json (S04l part B): how the ambient vehicle
 * kits sort a car's baked colours into the `light` bucket (src/scene/ambient/vehicleKits.ts).
 * Lane C's AmbientConfigSchema embeds it as `vehicleKit`.
 *
 * Values are linear RGB (three's working space, as the asset build bakes vertex colours). A
 * triangle outside the body slot is a lamp when it is a bright warm colour (head lamps) or a
 * strongly red one (tail lamps); everything else is `glass` (windows, tyres, trim). `lamps` adds
 * the lamps that glow at night (S04p).
 */
import { z } from 'zod'

const share = z.number().min(0).max(1)
const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

export const VehicleKitConfigSchema = z.strictObject({
  light: z.strictObject({
    /** Head lamp: red channel at least this… */
    warmMinRed: share,
    /** …and blue at most this share of red. */
    warmMaxBlueShare: share,
    /** Tail lamp: red channel at least this… */
    tailMinRed: share,
    /** …and green at most this share of red. */
    tailMaxGreenShare: share,
  }),
  /**
   * Night lamps (S04p): two small boxes on each car's nose (head lamps) and two on its tail
   * (tail lamps), baked into the `glass` part with the night-glow `_emissive` attribute, so they
   * glow as the night rig raises `uNightGlow`. Sizes are shares of the car's own width and height.
   */
  lamps: z.strictObject({
    /** Lamp width, as a share of the car's width. */
    widthShare: share,
    /** Lamp height, as a share of the car's height. */
    heightShare: share,
    /** Lamp depth (metres), sunk `insetM` into the nose or tail. */
    depthM: z.number().positive().max(0.5),
    insetM: z.number().min(0).max(0.5),
    /** Lamp centre off the middle, as a share of the car's width (each side). */
    xShare: share,
    /** Lamp centre height, as a share of the car's height. */
    yShare: share,
    /** Glow colours (sRGB hex), times `nightGlow`. */
    head: HexSchema,
    tail: HexSchema,
    nightGlow: z.number().positive().max(4),
  }),
})
export type VehicleKitConfig = z.infer<typeof VehicleKitConfigSchema>
