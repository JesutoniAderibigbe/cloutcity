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

/** Wall-clock fields of an instant in an IANA time zone. Month is 1-12, hour is 0-23. */
export interface WallClockParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  /** 0 = Sunday … 6 = Saturday, of the local date. */
  readonly weekday: number
  /** Minutes the zone is ahead of UTC at that instant (-300 in EST, -240 in EDT). */
  readonly utcOffsetMinutes: number
}

const wallClockFormats = new Map<string, Intl.DateTimeFormat>()

function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = wallClockFormats.get(timeZone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    wallClockFormats.set(timeZone, format)
  }
  return format
}

/**
 * The wall-clock time in `timeZone` at `epochMs` (time is passed in; nothing here reads the
 * real clock). Lives here because Intl is allowed only in this module. DST comes from the
 * runtime's tz database.
 */
export function wallClockParts(epochMs: number, timeZone: string): WallClockParts {
  assertFinite(epochMs, 'Epoch milliseconds')
  const parts = new Map(
    wallClockFormat(timeZone)
      .formatToParts(epochMs)
      .map((part) => [part.type, part.value]),
  )
  const field = (name: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second') => {
    const value = Number(parts.get(name))
    if (!Number.isInteger(value)) throw new RangeError(`No ${name} for ${epochMs} in ${timeZone}`)
    return value
  }
  const year = field('year')
  const month = field('month')
  const day = field('day')
  const hour = field('hour')
  const minute = field('minute')
  const second = field('second')
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const wholeSecondMs = Math.floor(epochMs / 1000) * 1000
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    utcOffsetMinutes: Math.round((wallAsUtc - wholeSecondMs) / 60_000),
  }
}
