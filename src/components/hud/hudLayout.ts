/**
 * The HUD grid (S05), shared by the frame, its skeleton and the live cells so the skeleton's
 * boxes are the live boxes: every cell is a fixed-height grid item in a named area, sized by the
 * grid, not by its content.
 *
 * - Phones: two rows of 44 px. Row 1: money, clock, speed, clout with the goal line. Row 2: the
 *   three stat meters under money and clock, the actions (sound, Places, More) under the rest.
 *   The clout column never drops below what the actions need (sound 110 + places 44 + More 44
 *   and their gaps, minus the speed column above them), so money and clock shrink first.
 * - `hud-wide` (≥ hudWideMinWidthPx): the same two rows with room for labels and every action;
 *   money and clock stay 88 px so that at 640 px the actions (sound, gear, Places, Inventory,
 *   Rent) still fit beside the stats.
 * - `hud-short` (a landscape phone): one row, everything side by side.
 * Heights: 2 × 44 + 4 gap + 2 × 6 padding = layout.json `hudHeightPx`; 44 + 2 × 6 =
 * `hudCompactHeightPx` (src/components/overlay/layers.test.ts).
 */
export const HUD_GRID = [
  // A solid tint (no backdrop blur, PERF-2) keeps the numbers readable over any part of the map.
  'grid h-full gap-1 bg-night-950/80 px-2 py-1.5',
  'grid-rows-[44px_44px]',
  'grid-cols-[minmax(56px,72px)_minmax(56px,68px)_44px_minmax(158px,1fr)]',
  "[grid-template-areas:'money_clock_speed_clout'_'stats_stats_actions_actions']",
  'hud-wide:grid-cols-[88px_88px_44px_minmax(0,1fr)]',
  "hud-wide:[grid-template-areas:'money_clock_speed_clout'_'stats_stats_stats_actions']",
  'hud-short:grid-rows-[44px]',
  'hud-short:grid-cols-[72px_72px_44px_minmax(120px,1fr)_minmax(90px,220px)_auto]',
  "hud-short:[grid-template-areas:'money_clock_speed_clout_stats_actions']",
  // A HUD island that failed to load offers its retry in the widest live cell.
  '[&>[data-zone-error]]:[grid-area:clout]',
].join(' ')

/** Every HUD cell: one 44 px row, clipped to its area. */
const CELL = 'flex h-11 min-w-0 overflow-hidden'

export const HUD_CELL = {
  money: `${CELL} [grid-area:money] flex-col justify-center`,
  clock: `${CELL} [grid-area:clock] flex-col justify-center`,
  speed: `${CELL} [grid-area:speed] items-center justify-center`,
  clout: `${CELL} [grid-area:clout] relative hud-wide:max-w-sm`,
  stats: `${CELL} [grid-area:stats] items-center gap-1.5`,
  actions: `${CELL} [grid-area:actions] items-center gap-1`,
} as const

export type HudCell = keyof typeof HUD_CELL
