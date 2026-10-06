/**
 * Transit balance numbers (data/config/balance.json `transit`, validated by TransitConfigSchema
 * in src/lib/data/data.test.ts). Read directly from the JSON, like src/engine/config.ts, so the
 * engine stays off classic zod. The subway fare is the `costs.subwayFare` anchor.
 */
import balanceJson from '@data/config/balance.json'
import type { TransitConfig as BalanceTransitConfig } from '@/lib/data/schemas/config'

export interface TransitConfig extends BalanceTransitConfig {
  /** Whole dollars for one subway trip, however many transfers it has. */
  readonly subwayFare: number
}

export const transitConfig: TransitConfig = {
  ...balanceJson.transit,
  subwayFare: balanceJson.costs.subwayFare,
}
