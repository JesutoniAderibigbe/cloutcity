'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { HUD_MORE_SELECTOR, focusFirstVisible } from '@/components/overlay/focusVisible'
import { useModalPresence } from '@/components/overlay/modalState'
import { trapTab } from '@/components/overlay/trapTab'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { creatorConfig } from '@/engine/creatorConfig'
import { creatorSteps } from '@/engine/creatorFlow'
import { copy, type CopyKey } from '@/lib/copy'
import { formatCount } from '@/lib/format'
import { creatorActions } from '@/state/creatorActions'
import { closeCreator } from '@/state/creatorOpen'
import { STEP_COMPONENTS } from './stepRegistry'
import { CREATOR_BUTTON, type StepBinding } from './stepTypes'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/creator'

const STEP_NAME: Readonly<Record<string, CopyKey>> = {
  look: 'creator.step.look',
  traits: 'creator.step.traits',
  dream: 'creator.step.dream',
  origin: 'creator.step.origin',
  neighborhood: 'creator.step.neighborhood',
  home: 'creator.step.home',
}

const stepName = (step: string) => copy(STEP_NAME[step] ?? 'creator.title')

/** Where focus goes when the creator closes: its HUD button, More on phones, else the map. */
function returnFocus() {
  focusFirstVisible(['[data-hud-creator]', HUD_MORE_SELECTOR, 'main'])
}

/**
 * The "Make it you" creator (S16a, D15): a modal over the game (the city pauses behind it while
 * the preview draws) that walks Look, Traits, Dream, the neighborhood roll and Home, each step
 * from the registry. Back, Skip and Next (Done on the last step) move through it; Next saves the step's choice through the store (the engine re-checks every rule) and stays
 * on the step, saying why, when it is refused. Skipping is recorded; Close or Escape leaves at
 * any time with everything saved so far kept, and the HUD opens it again. The step buttons are
 * guarded like the action lists (useActionGuard), so a double tap never skips a step.
 */
export function CreatorModal() {
  useModalPresence(true)
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const steps = creatorSteps(creatorConfig)
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [binding, setBinding] = useState<StepBinding | null>(null)
  const { guard, onKeyDown, onPointerDown, coolingDown } = useActionGuard()
  const step = steps[index] ?? steps[0] ?? 'look'
  const Step = STEP_COMPONENTS[step]
  const last = index === steps.length - 1

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [index])

  // On close, after the page behind stops being inert (the next frame).
  useEffect(
    () => () => {
      requestAnimationFrame(returnFocus)
    },
    [],
  )

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeCreator()
        return
      }
      trapTab(element, event)
    }
    element.addEventListener('keydown', onKey)
    return () => element.removeEventListener('keydown', onKey)
  }, [])

  const go = (to: number) => {
    setBinding(null)
    setIndex(Math.max(0, Math.min(steps.length - 1, to)))
  }

  const next = () => {
    const result = binding?.commit() ?? { ok: true as const, saved: null }
    if (!result.ok) {
      setStatus(result.error)
      return
    }
    if (last) {
      creatorActions().complete()
      setStatus(copy('creator.finished'))
      closeCreator()
      return
    }
    setStatus(result.saved)
    go(index + 1)
  }

  const skip = () => {
    creatorActions().skipStep(step)
    setStatus(null)
    if (last) {
      closeCreator()
      return
    }
    go(index + 1)
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-creator=""
      data-creator-step={step}
      data-cc-feature="cc-feature:creator"
      className="pointer-events-auto flex max-h-full w-full max-w-[var(--overlay-sheet-max-w)] flex-col gap-3 self-center overflow-hidden rounded-3xl border border-line glass p-4 shadow-2xl"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={titleId}
            tabIndex={-1}
            className="text-xl font-extrabold tracking-tight text-fg focus:outline-none"
          >
            {copy('creator.title')}
          </h2>
          <p data-creator-progress="" className="text-sm text-muted">
            {copy('creator.progress', {
              step: formatCount(index + 1),
              count: formatCount(steps.length),
              name: stepName(step),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={closeCreator}
          aria-label={copy('creator.closeLabel')}
          className={`${CREATOR_BUTTON} shrink-0 bg-raised text-fg`}
        >
          {copy('creator.close')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
        {Step === undefined ? null : <Step key={step} bind={setBinding} />}
      </div>

      <p
        role="status"
        data-creator-status=""
        className="min-h-5 text-sm font-semibold text-taxi-ink"
      >
        {status}
      </p>

      <nav aria-label={copy('creator.title')} aria-busy={coolingDown} className="flex gap-2">
        <button
          type="button"
          disabled={index === 0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onClick={(event) => guard(event, `back-${step}`, () => go(index - 1))}
          className={`${CREATOR_BUTTON} bg-raised text-fg`}
        >
          {copy('creator.back')}
        </button>
        <button
          type="button"
          data-creator-skip=""
          aria-label={copy('creator.skipLabel', { name: stepName(step) })}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onClick={(event) => guard(event, `skip-${step}`, skip)}
          className={`${CREATOR_BUTTON} ml-auto bg-raised text-fg`}
        >
          {copy('creator.skip')}
        </button>
        <button
          type="button"
          data-creator-next=""
          disabled={binding === null || !binding.ready}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onClick={(event) => guard(event, `next-${step}`, next)}
          className={`${CREATOR_BUTTON} bg-taxi text-on-taxi`}
        >
          {copy(last ? 'creator.finish' : 'creator.next')}
        </button>
      </nav>
    </div>
  )
}
