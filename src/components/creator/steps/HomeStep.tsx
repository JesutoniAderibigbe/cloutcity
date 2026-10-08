'use client'

import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { heldRoll } from '@/engine/creatorFlow'
import { copy } from '@/lib/copy'
import { neighborhoodName } from '@/lib/creatorCopy'
import { homeName } from '@/lib/economyCopy'
import { log } from '@/lib/log'
import { creatorActions } from '@/state/creatorActions'
import { useGameStore } from '@/state/store'
import { tripStore } from '@/state/trip'
import { CREATOR_BUTTON, MOVE_ON, type StepProps } from '../stepTypes'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/housing'

/**
 * The Home step (S16a, D18): the startable homes in the rolled neighborhood (S16a has only the
 * room the player rents; S44 adds more), and Move in, which settles the player's home there.
 * Moving in waits while a trip is under way (DEC-22). Done finishes the creator either way.
 */
export default function HomeStep({ bind }: StepProps) {
  const held = useGameStore((state) => heldRoll(state, 'neighborhood', engineConfig))
  const home = useGameStore((state) => state.player.home)
  const livesIn = useGameStore((state) => state.player.neighborhood)
  const traveling = useStore(tripStore, (state) => state.active !== null)
  const [result, setResult] = useState<string | null>(null)
  const { guard, onKeyDown, onPointerDown, coolingDown } = useActionGuard()
  const neighborhood = creatorConfig.neighborhoods.find((n) => n.id === held?.result)

  useEffect(() => {
    bind({ ready: true, commit: () => MOVE_ON })
  }, [bind])

  if (neighborhood === undefined) {
    return (
      <section data-creator-home="" className="flex flex-col gap-2">
        <p className="text-sm text-fg">{copy('creator.home.notRolled')}</p>
      </section>
    )
  }
  const place = neighborhoodName(neighborhood.id)

  const moveIn = (homeId: string) => {
    const outcome = creatorActions().moveIntoNeighborhood(homeId)
    if (outcome.ok) {
      setResult(copy('creator.home.moved', { neighborhood: place }))
      // Move in becomes "You live here" under the tap: hand focus on to Done.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-creator-next]')?.focus(),
      )
      return
    }
    log.info('Moving in was refused', { code: outcome.error.code })
    setResult(copy('creator.error.failed'))
  }

  return (
    <section data-creator-home="" className="flex flex-col gap-2">
      <p className="text-sm text-fg">{copy('creator.home.intro', { neighborhood: place })}</p>
      {traveling ? <p className="text-sm text-taxi-ink">{copy('creator.home.trip')}</p> : null}
      <ul aria-busy={coolingDown} className="flex flex-col gap-1.5">
        {neighborhood.homes.map((homeId) => {
          const yours = homeId === home
          const here = yours && livesIn === neighborhood.id
          const blocked = !yours
            ? copy('creator.home.notYours')
            : traveling
              ? copy('creator.home.trip')
              : null
          return (
            <li
              key={homeId}
              data-creator-home-option={homeId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised p-2.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-fg">{homeName(homeId)}</span>
                {blocked === null ? null : <span className="text-xs text-muted">{blocked}</span>}
              </span>
              {here ? (
                <span className="text-sm font-semibold text-taxi-ink">
                  {copy('creator.home.here')}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={blocked !== null}
                  data-creator-move-in={homeId}
                  aria-label={copy('creator.home.moveInLabel', {
                    home: homeName(homeId),
                    neighborhood: place,
                  })}
                  onKeyDown={onKeyDown}
                  onPointerDown={onPointerDown}
                  onClick={(event) => guard(event, homeId, () => moveIn(homeId))}
                  className={`${CREATOR_BUTTON} bg-taxi text-on-taxi`}
                >
                  {copy('creator.home.moveIn')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p aria-live="polite" className="min-h-5 text-sm font-semibold text-taxi-ink">
        {result}
      </p>
    </section>
  )
}
