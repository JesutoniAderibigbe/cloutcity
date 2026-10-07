/**
 * Home ids and the lowest-rent rule, shared by the balance schema (schemas/config.ts) and the
 * engine (src/engine/rent.ts) so both agree on which home is the eviction target. No imports:
 * Node loads this file directly from scripts/ through schemas/config.ts.
 */
export const HOME_IDS = ['queens-room', 'brooklyn-1br', 'manhattan-loft'] as const
export type HomeIdLiteral = (typeof HOME_IDS)[number]

/** The home with the lowest weekly rent; on a tie, the first in HOME_IDS. */
export function lowestRentHome(
  rentPerWeek: Readonly<Record<HomeIdLiteral, number>>,
): HomeIdLiteral {
  return HOME_IDS.reduce((lowest, id) => (rentPerWeek[id] < rentPerWeek[lowest] ? id : lowest))
}
