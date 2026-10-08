/**
 * The map's two styles (S04m, DEC-59): the Lagos-style game map and the realistic city. A plain
 * module (no zod) so client code (the style store, chip and settings) can import it.
 */
export const MAP_STYLES = ['game', 'real'] as const
export type MapStyleId = (typeof MAP_STYLES)[number]
