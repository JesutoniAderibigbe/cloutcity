/**
 * The only number formatters for player-facing text (UX-2, GR-11). ESLint bans
 * `Intl.NumberFormat` and `toLocaleString` everywhere else under src/.
 */

// Rounding: Intl's default `halfExpand`, i.e. to the nearest whole dollar with halves away from
// zero ($12.50 → $13, -$12.50 → -$13). `signDisplay: 'negative'` drops the sign of anything
// that rounds to zero, so -$0.40 shows as $0.
const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  signDisplay: 'negative',
})

const COUNT = new Intl.NumberFormat('en-US', { notation: 'compact' })

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number: ${value}`)
}

/** Money in whole US dollars: `12.5` → `"$13"`, `1100` → `"$1,100"`. */
export function formatMoney(dollars: number): string {
  assertFinite(dollars, 'Money')
  return MONEY.format(dollars)
}

/**
 * Counts in compact notation: `950` → `"950"`, `15274` → `"15K"`, `1_380_000` → `"1.4M"`.
 * Counts are whole: the value is first rounded to the nearest integer (`Math.round`, halves
 * toward +∞), and a result of -0 shows as `"0"`.
 */
export function formatCount(count: number): string {
  assertFinite(count, 'Count')
  // `|| 0` turns -0 (e.g. Math.round(-0.4)) into 0.
  return COUNT.format(Math.round(count) || 0)
}
