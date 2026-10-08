/**
 * The `vehicleKit` block of data/config/ambient.json (S04l part B): how the ambient vehicle
 * kits sort a car's baked colours into the `light` bucket (src/scene/ambient/vehicleKits.ts).
 * Lane C's AmbientConfigSchema embeds it as `vehicleKit`.
 *
 * Values are linear RGB (three's working space, as the asset build bakes vertex colours). A
 * triangle outside the body slot is a lamp when it is a bright warm colour (head lamps) or a
 * strongly red one (tail lamps); everything else is `glass` (windows, tyres, trim).
 */
import { z } from 'zod'

const share = z.number().min(0).max(1)

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
})
export type VehicleKitConfig = z.infer<typeof VehicleKitConfigSchema>
