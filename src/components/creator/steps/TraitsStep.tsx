'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { changeAvailableAt } from '@/engine/career'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { traitPickCount } from '@/engine/traits'
import { copy } from '@/lib/copy'
import { cooldownLine, traitEffectLines, traitFlavor, traitName } from '@/lib/creatorCopy'
import { formatCount } from '@/lib/format'
import { creatorActions } from '@/state/creatorActions'
import { useGameStore } from '@/state/store'
import { MOVE_ON, type StepProps } from '../stepTypes'

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * The Traits step (S16a, D16): the eight traits as native checkboxes, each with its flavour and
 * its effect lines built from its `effects` (GR-10). Exactly `pick` are saved; ticking one more
 * than that is refused and said why. A different pair waits for the change cooldown, which the
 * step names.
 */
export default function TraitsStep({ bind }: StepProps) {
  const traits = useGameStore((state) => state.player.traits)
  const changedAt = useGameStore((state) => state.player.traitsChangedAt)
  const minute = useGameStore((state) => state.clock.minute)
  const pick = traitPickCount(engineConfig)
  const [picked, setPicked] = useState<readonly string[]>(traits)
  // What Next saves, kept current by the change handler (see DreamStep).
  const chosen = useRef<readonly string[]>(traits)
  const [note, setNote] = useState<string | null>(null)
  const countId = useId()
  const availableAt = changeAvailableAt(changedAt, minute, engineConfig)

  useEffect(() => {
    bind({
      ready: true,
      commit: () => {
        const picked = chosen.current
        if (same(picked, traits)) return MOVE_ON
        if (picked.length !== pick) {
          return { ok: false, error: copy('creator.traits.need', { count: formatCount(pick) }) }
        }
        const result = creatorActions().chooseTraits(picked)
        if (result.ok) return { ok: true, saved: copy('creator.traits.saved') }
        return {
          ok: false,
          error:
            result.error.code === 'CHANGE_COOLDOWN'
              ? cooldownLine(result.error.availableAt, minute)
              : copy('creator.error.failed'),
        }
      },
    })
  }, [bind, traits, pick, minute])

  const toggle = (id: string, on: boolean) => {
    const list = chosen.current
    if (on && list.length >= pick) {
      setNote(copy('creator.traits.full', { count: formatCount(pick) }))
      return
    }
    const nextList = on ? [...list, id] : list.filter((entry) => entry !== id)
    chosen.current = nextList
    setNote(null)
    setPicked(nextList)
  }

  return (
    <section data-creator-traits="" className="flex flex-col gap-2">
      <p className="text-sm text-muted">{copy('creator.traits.intro')}</p>
      {availableAt === null ? null : (
        <p className="text-sm text-fg">{cooldownLine(availableAt, minute)}</p>
      )}
      <fieldset aria-describedby={countId} className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-fg">
          {copy('creator.traits.pick', { count: formatCount(pick) })}
        </legend>
        <p id={countId} className="text-xs text-muted">
          {copy('creator.traits.count', {
            picked: formatCount(picked.length),
            count: formatCount(pick),
          })}
        </p>
        {creatorConfig.traits.traits.map((trait) => {
          const checked = picked.includes(trait.id)
          return (
            <label
              key={trait.id}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-raised p-2.5 has-[:checked]:ring-2 has-[:checked]:ring-taxi has-[:checked]:ring-inset"
            >
              <input
                type="checkbox"
                name="creator-traits"
                value={trait.id}
                checked={checked}
                data-trait={trait.id}
                onChange={(event) => toggle(trait.id, event.target.checked)}
                className="mt-0.5 h-6 w-6 shrink-0 accent-taxi-ink"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-fg">{traitName(trait.id)}</span>
                <span className="text-xs text-muted">{traitFlavor(trait.id)}</span>
                {traitEffectLines(trait.id).map((line) => (
                  <span key={line} className="text-xs text-fg">
                    {line}
                  </span>
                ))}
              </span>
            </label>
          )
        })}
      </fieldset>
      <p aria-live="polite" className="min-h-5 text-sm text-taxi-ink">
        {note}
      </p>
    </section>
  )
}
