'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { changeAvailableAt } from '@/engine/career'
import { engineConfig } from '@/engine/config'
import { copy } from '@/lib/copy'
import { careerBonusLine, careerGoalLine, careerName, cooldownLine } from '@/lib/creatorCopy'
import { CAREER_PATHS, type CareerPathId } from '@/lib/data/avatarIds'
import { creatorActions } from '@/state/creatorActions'
import { useGameStore } from '@/state/store'
import { MOVE_ON, type StepProps } from '../stepTypes'

/**
 * The Dream step (S16a, DEC-20): the four career paths as native radios, each with the goal it
 * sets and its bonus, both built from balance.json `career` (GR-10). Saving it changes the HUD's
 * goal line; a change waits for the cooldown, which the step names.
 */
export default function DreamStep({ bind }: StepProps) {
  const careerPath = useGameStore((state) => state.player.careerPath)
  const changedAt = useGameStore((state) => state.player.careerChangedAt)
  const minute = useGameStore((state) => state.clock.minute)
  const [draft, setDraft] = useState<CareerPathId | null>(careerPath)
  // What Next saves: set in the change handler, so a Next pressed straight after a pick (before
  // the binding effect re-runs) still saves that pick.
  const chosen = useRef<CareerPathId | null>(careerPath)
  const idBase = useId()
  const availableAt = changeAvailableAt(changedAt, minute, engineConfig)

  useEffect(() => {
    bind({
      ready: true,
      commit: () => {
        const path = chosen.current
        if (path === null) return { ok: false, error: copy('creator.dream.need') }
        if (path === careerPath) return MOVE_ON
        const result = creatorActions().chooseCareer(path)
        if (result.ok) {
          return { ok: true, saved: copy('creator.dream.saved', { goal: careerGoalLine(path) }) }
        }
        return {
          ok: false,
          error:
            result.error.code === 'CHANGE_COOLDOWN'
              ? cooldownLine(result.error.availableAt, minute)
              : copy('creator.error.failed'),
        }
      },
    })
  }, [bind, careerPath, minute])

  return (
    <section data-creator-dream="" className="flex flex-col gap-2">
      <p className="text-sm text-muted">{copy('creator.dream.intro')}</p>
      {availableAt === null ? null : (
        <p className="text-sm text-fg">{cooldownLine(availableAt, minute)}</p>
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-fg">{copy('creator.dream.legend')}</legend>
        {CAREER_PATHS.map((path) => (
          <label
            key={path}
            htmlFor={`${idBase}-${path}`}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-raised p-2.5 has-[:checked]:ring-2 has-[:checked]:ring-taxi has-[:checked]:ring-inset"
          >
            <input
              id={`${idBase}-${path}`}
              type="radio"
              name="creator-dream"
              value={path}
              checked={draft === path}
              data-career={path}
              onChange={() => {
                chosen.current = path
                setDraft(path)
              }}
              className="mt-0.5 h-6 w-6 shrink-0 accent-taxi-ink"
            />
            <span className="flex min-w-0 flex-col font-semibold text-fg">
              {careerName(path)}
              <span className="text-xs font-normal text-fg">{careerGoalLine(path)}</span>
              <span className="text-xs font-normal text-muted">{careerBonusLine(path)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}
