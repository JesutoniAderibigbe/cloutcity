import type { CSSProperties } from 'react'

interface MapAttributionProps {
  readonly nyc: string
  readonly mta: string
  /** One-line form for a short free scene row (landscape phones). */
  readonly compact: string
  readonly credits: string
  /** The chip's label ("Map data"). */
  readonly toggle: string
  /** The overlay grid rows (src/components/overlay/layers.ts). */
  readonly gridTemplateRows: string
  /** Where the chip sits while the sheet zone is empty: the free row down to the tab bar. */
  readonly rows: string
  /** Where it sits while a sheet is open: the free scene row only. */
  readonly busyRow: number
}

/**
 * Required map attribution (NYC Open Data, MTA; data/geo/SOURCES.md). A small "ⓘ Map data" pill
 * (a 44 px target around it) in the screen's bottom-end corner, just above the tab bar, while no
 * sheet is open: the empty toast and sheet rows leave the lower part of a phone's map bare, and
 * the free row's own corner sat in the middle of it (UX-15). While a sheet is open the chip
 * moves up to the free scene row's bottom-end corner, so it never sits under the sheet nor over
 * any HUD, toast or tab bar (UX-1; globals.css `.map-attribution-row`, CSS only). One tap opens
 * the attribution and the link to /credits, where the full text lives. A native `<details>`: no JavaScript, so
 * nothing joins the shell, and it opens with the keyboard as well as a tap. When the row is too
 * short for the two-line text, a container query (globals.css, `.map-attribution-row`) swaps in
 * the one-line form; the row never shrinks below one 44 px target (layout.json
 * `freeSceneMinHeightPx`). It hides while the apartment has the screen (globals.css, UI-16): it
 * credits the map, and comes back with it.
 *
 * The credits link is a plain anchor, not next/link: next/link would cost the shell bundle about
 * 4.6 KB gz for one rarely used navigation.
 */
export function MapAttribution({
  nyc,
  mta,
  compact,
  credits,
  toggle,
  gridTemplateRows,
  rows,
  busyRow,
}: MapAttributionProps) {
  return (
    <div
      data-map-attribution-layer=""
      className="pointer-events-none absolute inset-0 grid grid-cols-1"
      style={{ gridTemplateRows }}
    >
      <div
        className="map-attribution-row flex min-h-0 items-end justify-end overflow-hidden px-1"
        style={
          {
            '--cc-attribution-rows': rows,
            '--cc-attribution-busy-row': busyRow,
          } as CSSProperties
        }
      >
        <details
          data-map-attribution=""
          className="pointer-events-auto relative text-[11px] leading-snug text-muted"
        >
          {/* The 44 px target stays; only the pill inside it shows, so the chip reads as quiet. */}
          <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-end rounded-lg px-1 font-semibold text-fg focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1 rounded-full glass px-2 py-0.5 text-[10px] opacity-85">
              <span aria-hidden="true">ⓘ</span>
              {toggle}
            </span>
          </summary>
          {/* Opens to the left of the chip, on the same bottom line, so it fits the shortest free
              row (one 44 px target tall) and never reaches into another zone. */}
          <div className="absolute right-full bottom-0 mr-1 flex w-max max-w-[calc(100vw-7.5rem)] items-center gap-2 rounded-lg glass py-0.5 pr-0.5 pl-2">
            <p className="map-attribution-full">
              {nyc}
              <br />
              {mta}
            </p>
            {/* Wraps rather than truncates: it is required attribution, so it must be readable
                in full. Two 11 px lines fit beside the 44 px Credits target. */}
            <p className="map-attribution-compact">{compact}</p>
            <a
              href="/credits"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-semibold text-fg underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {credits}
            </a>
          </div>
        </details>
      </div>
    </div>
  )
}
