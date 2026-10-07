interface MapAttributionProps {
  readonly nyc: string
  readonly mta: string
  /** One-line form for a short free scene row (landscape phones). */
  readonly compact: string
  readonly credits: string
  /** The overlay grid rows and free scene row (src/components/overlay/layers.ts). */
  readonly gridTemplateRows: string
  readonly row: number
}

/**
 * Required map attribution (NYC Open Data, MTA; data/geo/SOURCES.md), always visible over the
 * map. It sits in the free scene row of the overlay grid, bottom-end, so no HUD, sheet, toast
 * or tab bar covers it (UX-1); the full text is on /credits. When the row is too short for the
 * two-line form, a container query (globals.css, `.map-attribution-row`) swaps in the one-line
 * form; the row never shrinks below one 44 px link (layout.json `freeSceneMinHeightPx`).
 *
 * The credits link is a plain anchor, not next/link: next/link would cost the shell bundle about
 * 4.6 KB gz for one rarely used navigation.
 */
export function MapAttribution({
  nyc,
  mta,
  compact,
  credits,
  gridTemplateRows,
  row,
}: MapAttributionProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 grid grid-cols-1"
      style={{ gridTemplateRows }}
    >
      <div
        className="map-attribution-row flex min-h-0 items-end justify-end overflow-hidden px-2 py-1"
        style={{ gridRow: row }}
      >
        <div
          data-map-attribution=""
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-lg bg-night-950 py-0.5 pr-0.5 pl-2 text-[11px] leading-snug text-ink-300"
        >
          <p className="map-attribution-full">
            {nyc}
            <br />
            {mta}
          </p>
          <p className="map-attribution-compact truncate">{compact}</p>
          <a
            href="/credits"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-semibold text-ink-50 underline focus-visible:outline-2 focus-visible:outline-taxi-400"
          >
            {credits}
          </a>
        </div>
      </div>
    </div>
  )
}
