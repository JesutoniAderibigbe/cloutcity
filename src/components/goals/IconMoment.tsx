'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useModalPresence } from '@/components/overlay/modalState'
import { trapTab } from '@/components/overlay/trapTab'
import { engineConfig } from '@/engine/config'
import { prestigeBadge } from '@/engine/grants'
import { copy } from '@/lib/copy'
import { cloutLevelName } from '@/lib/economyCopy'
import { badgeName, prestigePartName } from '@/lib/goalsCopy'
import { log } from '@/lib/log'
import { shareMoment, type ShareOutcome } from '@/lib/share/shareMoment'
import { gameStore, useGameStore } from '@/state/store'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/goals'
import '@/lib/copy/ns/share'

const BUTTON =
  'min-h-11 min-w-11 rounded-xl px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400'

/** Where focus goes when the moment closes: the HUD's Goals button, else the map. */
function returnFocus() {
  const target =
    document.querySelector<HTMLElement>('[data-hud-panel="goals"]') ??
    document.querySelector<HTMLElement>('main')
  target?.focus()
}

/**
 * The Icon moment (S15): the victory screen shown once a run reaches the victory goal, over
 * everything (a modal; the page behind is inert). It offers Share (src/lib/share/shareMoment.ts),
 * Prestige (a second step that lists, from config, what starts over and what is kept, and names
 * the effect on its button) and Keep playing, which closes it for the rest of the run. Escape
 * keeps playing (or steps back from the confirm). Focus starts on the title and stays inside.
 * The celebration is CSS only and off under reduced motion. Loaded lazily by IconMomentMount
 * (DEC-11) only while the moment is pending.
 */
export function IconMoment() {
  useModalPresence(true)
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const [step, setStep] = useState<'moment' | 'confirm'>('moment')
  const [shared, setShared] = useState<ShareOutcome | null>(null)
  const [refused, setRefused] = useState(false)
  const run = useGameStore((state) => state.goals.run)

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [step])

  // On close, after the page behind stops being inert (the next frame): the Goals button.
  useEffect(
    () => () => {
      requestAnimationFrame(returnFocus)
    },
    [],
  )

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (step === 'confirm') setStep('moment')
        else gameStore.getState().acknowledgeIconMoment()
        return
      }
      trapTab(element, event)
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [step])

  const share = () => {
    const text = `${copy('share.icon.text')} ${copy('share.footer')}`
    void shareMoment(text, window.location.origin).then(setShared)
  }

  const confirmPrestige = () => {
    const result = gameStore.getState().startPrestige()
    if (!result.ok) {
      log.info('Prestige was refused', { code: result.error.code })
      setRefused(true)
    }
  }

  const startLevel = cloutLevelName(engineConfig.clout.levels[0]?.id ?? '')
  const badge = badgeName(prestigeBadge(run, engineConfig))

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-icon-moment={step}
      data-cc-feature="cc-feature:icon-moment"
      className="pointer-events-auto relative max-h-full w-full max-w-[var(--overlay-sheet-max-w)] self-center overflow-y-auto overscroll-contain rounded-3xl border border-pink-400 bg-night-900 p-5 shadow-2xl"
    >
      <div aria-hidden="true" className="icon-moment-burst pointer-events-none absolute inset-0" />
      {step === 'moment' ? (
        <div className="relative flex flex-col gap-3">
          <h2
            id={titleId}
            tabIndex={-1}
            className="text-2xl font-extrabold text-pink-400 focus:outline-none"
          >
            {copy('goals.icon.title')}
          </h2>
          <p id={bodyId} className="text-base text-ink-50">
            {copy('goals.icon.body')}
          </p>
          <p role="status" className="min-h-5 text-sm font-semibold text-taxi-400">
            {shared === null || shared.kind === 'cancelled'
              ? null
              : shared.kind === 'shared'
                ? copy('goals.icon.shared')
                : shared.kind === 'copied'
                  ? copy('goals.icon.copied')
                  : copy('goals.icon.copyThis')}
          </p>
          {shared?.kind === 'shown' ? (
            <p
              data-share-text=""
              className="rounded-xl bg-night-950 p-2 text-sm text-ink-50 select-all"
            >
              {shared.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={share}
              className={`${BUTTON} bg-pink-400 text-night-950`}
            >
              {copy('goals.icon.share')}
            </button>
            <button
              type="button"
              onClick={() => setStep('confirm')}
              className={`${BUTTON} bg-taxi-400 text-night-950`}
            >
              {copy('goals.icon.prestige')}
            </button>
            <button
              type="button"
              onClick={() => gameStore.getState().acknowledgeIconMoment()}
              className={`${BUTTON} bg-night-800 text-ink-50`}
            >
              {copy('goals.icon.keepPlaying')}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col gap-3">
          <h2
            id={titleId}
            tabIndex={-1}
            className="text-2xl font-extrabold text-pink-400 focus:outline-none"
          >
            {copy('goals.icon.confirm.title')}
          </h2>
          <div id={bodyId} className="flex flex-col gap-2 text-sm text-ink-50">
            <p>{copy('goals.icon.confirm.body')}</p>
            <p className="font-semibold text-taxi-400">
              {copy('goals.icon.confirm.badge', { badge })}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <section aria-label={copy('goals.icon.confirm.resets')}>
              <h3 className="text-xs font-bold text-ink-300 uppercase">
                {copy('goals.icon.confirm.resets')}
              </h3>
              <ul data-prestige-resets="" className="list-inside list-disc text-sm text-ink-50">
                {engineConfig.prestige.resets.map((part) => (
                  <li key={part}>{prestigePartName(part)}</li>
                ))}
              </ul>
            </section>
            <section aria-label={copy('goals.icon.confirm.keeps')}>
              <h3 className="text-xs font-bold text-ink-300 uppercase">
                {copy('goals.icon.confirm.keeps')}
              </h3>
              <ul data-prestige-keeps="" className="list-inside list-disc text-sm text-ink-50">
                {engineConfig.prestige.keeps.map((part) => (
                  <li key={part}>{prestigePartName(part)}</li>
                ))}
              </ul>
            </section>
          </div>
          <p role="status" className="min-h-5 text-sm font-semibold text-taxi-400">
            {refused ? copy('goals.icon.confirm.refused') : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmPrestige}
              className={`${BUTTON} bg-taxi-400 text-night-950`}
            >
              {copy('goals.icon.confirm.go', { level: startLevel })}
            </button>
            <button
              type="button"
              onClick={() => setStep('moment')}
              className={`${BUTTON} bg-night-800 text-ink-50`}
            >
              {copy('goals.icon.confirm.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
