'use client'

import Link from 'next/link'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { setSoundSheetOpen } from '@/components/audio/soundSheet'
import { CLEAN_SCREEN_ATTR } from '@/components/nav/CleanScreenExit'
import { resumeTour } from '@/components/tour/tourControl'
import { copy, type CopyKey } from '@/lib/copy'
import { SHORTCUTS_SCREEN, phoneConfig } from '@/lib/phone/phoneConfig'
import { MAP_STYLES } from '@/lib/world/mapStyleIds'
import { dismissHudPanel } from '@/state/hudPanel'
import { setMapStyle, useMapStyle } from '@/state/mapStyle'
import { PHONE_BUTTON } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/map'
import '@/lib/copy/ns/phone'

const LEGAL = [
  { href: '/terms', labelKey: 'phone.legal.terms' },
  { href: '/privacy', labelKey: 'phone.legal.privacy' },
  { href: '/conduct', labelKey: 'phone.legal.conduct' },
  { href: '/credits', labelKey: 'phone.legal.credits' },
] as const satisfies readonly { href: string; labelKey: CopyKey }[]

const ROW = `${PHONE_BUTTON} flex w-full items-center justify-between gap-3 bg-surface text-left text-fg enabled:hover:bg-raised`

/** Copy ids name keys (`phone.keys.<id>.keys`): phone.json lists them, data.test checks them. */
const keyText = (id: string, part: 'keys' | 'does') => copy(`phone.keys.${id}.${part}` as CopyKey)
const faqText = (id: string, part: 'q' | 'a') => copy(`phone.help.faq.${id}.${part}` as CopyKey)

/** Watches the root's clean-screen attribute (the HUD's Show the HUD button also clears it). */
function subscribeCleanScreen(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributeFilter: [CLEAN_SCREEN_ATTR] })
  return () => observer.disconnect()
}

function useCleanScreen(): boolean {
  return useSyncExternalStore(
    subscribeCleanScreen,
    () => document.documentElement.hasAttribute(CLEAN_SCREEN_ATTR),
    () => false,
  )
}

/**
 * Settings & Help (S58, S48 lite): sound and graphics (the settings sheet), the clean-screen
 * HUD toggle, the map style (S04m, also on the map's chip), the tour replay, the keyboard shortcuts (also opened with `?`, which lands here at
 * the shortcuts), the Help questions from data/copy and the fine print.
 */
export function SettingsApp({ screen }: { readonly screen: string }) {
  const shortcutsRef = useRef<HTMLHeadingElement>(null)
  const clean = useCleanScreen()
  const mapStyle = useMapStyle()

  // `?` asks for the shortcuts: bring them into view and give them focus.
  useEffect(() => {
    if (screen !== SHORTCUTS_SCREEN) return
    const heading = shortcutsRef.current
    heading?.scrollIntoView({ block: 'start' })
    heading?.focus()
  }, [screen])

  const toggleClean = () => {
    const next = !clean
    document.documentElement.toggleAttribute(CLEAN_SCREEN_ATTR, next)
    // Clean screen is for looking at the city: the phone steps aside too.
    if (next) dismissHudPanel()
  }

  return (
    <div data-cc-feature="cc-feature:phone-settings" className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h4 className="text-xs font-bold text-muted uppercase">{copy('phone.settings.heading')}</h4>
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line">
          <button
            type="button"
            data-phone-setting="sound"
            onClick={() => {
              dismissHudPanel()
              setSoundSheetOpen(true)
            }}
            className={`${ROW} rounded-none`}
          >
            <RowText
              icon="🔊"
              title={copy('phone.settings.sound')}
              hint={copy('phone.settings.soundHint')}
            />
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={clean}
            data-phone-setting="clean-screen"
            onClick={toggleClean}
            className={`${ROW} rounded-none`}
          >
            <RowText
              icon="🌆"
              title={copy('phone.settings.clean')}
              hint={copy('phone.settings.cleanHint')}
            />
            <span
              aria-hidden="true"
              className={`relative h-7 w-12 shrink-0 rounded-full border border-line-strong transition-colors motion-reduce:transition-none ${
                clean ? 'bg-taxi' : 'bg-track'
              }`}
            >
              <span
                className={`absolute top-0.5 size-5.5 rounded-full bg-surface shadow transition-[left] motion-reduce:transition-none ${
                  clean ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </span>
          </button>
          <div data-phone-setting="map-style" className={`${ROW} rounded-none`}>
            <RowText
              icon="🗺️"
              title={copy('phone.settings.mapStyle')}
              hint={copy('phone.settings.mapStyleHint')}
            />
            <span
              role="group"
              aria-label={copy('phone.settings.mapStyle')}
              className="flex shrink-0 rounded-full border border-line-strong bg-track p-0.5 text-xs font-semibold"
            >
              {MAP_STYLES.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mapStyle === id}
                  data-map-style-option={id}
                  onClick={() => setMapStyle(id)}
                  className={`min-h-11 rounded-full px-2.5 focus-visible:outline-2 focus-visible:outline-focus ${
                    mapStyle === id ? 'bg-taxi text-on-taxi' : 'text-fg'
                  }`}
                >
                  {copy(id === 'game' ? 'map.style.game' : 'map.style.real')}
                </button>
              ))}
            </span>
          </div>
          <button
            type="button"
            data-phone-setting="tour"
            onClick={() => {
              dismissHudPanel()
              resumeTour()
            }}
            className={`${ROW} rounded-none`}
          >
            <RowText
              icon="🧭"
              title={copy('phone.settings.tour')}
              hint={copy('phone.settings.tourHint')}
            />
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-1.5" data-phone-shortcuts="">
        <h4
          ref={shortcutsRef}
          tabIndex={-1}
          className="scroll-mt-2 text-xs font-bold text-muted uppercase focus:outline-none focus-visible:outline-2 focus-visible:outline-focus"
        >
          {copy('phone.keys.heading')}
        </h4>
        <p className="text-sm text-muted">{copy('phone.keys.intro')}</p>
        <dl className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {phoneConfig.help.shortcuts.map((id) => (
            <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
              <dt>
                <kbd className="rounded-lg border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs font-bold text-fg">
                  {keyText(id, 'keys')}
                </kbd>
              </dt>
              <dd className="text-right text-sm text-fg">{keyText(id, 'does')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-xs font-bold text-muted uppercase">{copy('phone.help.heading')}</h4>
        <div className="flex flex-col gap-1.5">
          {phoneConfig.help.faq.map((id) => (
            <details
              key={id}
              data-phone-faq={id}
              className="group rounded-2xl border border-line bg-surface"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                {faqText(id, 'q')}
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
                >
                  ›
                </span>
              </summary>
              <p className="px-3 pb-3 text-sm text-muted">{faqText(id, 'a')}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-xs font-bold text-muted uppercase">{copy('phone.legal.heading')}</h4>
        <ul className="grid grid-cols-2 gap-1.5">
          {LEGAL.map(({ href, labelKey }) => (
            <li key={href}>
              <Link
                href={href}
                className={`${PHONE_BUTTON} flex items-center justify-center bg-raised text-fg underline-offset-2 hover:underline`}
              >
                {copy(labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function RowText({
  icon,
  title,
  hint,
}: {
  readonly icon: string
  readonly title: string
  readonly hint: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-lg leading-none"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-xs font-normal text-muted">{hint}</span>
      </span>
    </span>
  )
}
