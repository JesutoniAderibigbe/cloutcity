'use client'

import { useEffect, useState } from 'react'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { heldRoll } from '@/engine/creatorFlow'
import { copy } from '@/lib/copy'
import { neighborhoodName } from '@/lib/creatorCopy'
import { log } from '@/lib/log'
import { creatorActions } from '@/state/creatorActions'
import { useGameStore } from '@/state/store'
import { DiceReveal } from '../DiceReveal'
import { CREATOR_BUTTON, MOVE_ON, type StepProps } from '../stepTypes'

/**
 * The neighborhood roll (S16a, D15/D18): the Queens start neighborhoods the dice pick from, and
 * one roll per save. The result is saved before the reveal shows it, so a reload or a second
 * visit shows the same neighborhood, without tumbling again. Next waits for the roll.
 */
export default function NeighborhoodStep({ bind }: StepProps) {
  const held = useGameStore((state) => heldRoll(state, 'neighborhood', engineConfig))
  const [tumble, setTumble] = useState(false)
  const [landed, setLanded] = useState(held !== undefined)
  const [failed, setFailed] = useState(false)
  const { guard, onKeyDown, onPointerDown } = useActionGuard()
  const faces = creatorConfig.neighborhoods.map((n) => neighborhoodName(n.id))

  useEffect(() => {
    bind({ ready: held !== undefined && landed, commit: () => MOVE_ON })
  }, [bind, held, landed])

  const roll = () => {
    const result = creatorActions().rollNeighborhood()
    if (!result.ok) {
      log.info('The neighborhood roll was refused', { code: result.error.code })
      setFailed(true)
      return
    }
    setFailed(false)
    setLanded(false)
    setTumble(!result.replayed)
  }

  return (
    <section data-creator-roll="" className="flex flex-col gap-2">
      <h3 className="text-base font-extrabold text-fg">{copy('creator.roll.title')}</h3>
      <p className="text-sm text-muted">{copy('creator.roll.intro')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {creatorConfig.neighborhoods.map((n) => (
          <li
            key={n.id}
            data-neighborhood={n.id}
            className="rounded-full bg-raised px-3 py-1 text-sm text-fg"
          >
            {neighborhoodName(n.id)}
          </li>
        ))}
      </ul>
      {held === undefined ? (
        <button
          type="button"
          data-creator-roll-button=""
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onClick={(event) => guard(event, 'roll', roll)}
          className={`${CREATOR_BUTTON} self-start bg-taxi text-on-taxi`}
        >
          {copy('creator.roll.button')}
        </button>
      ) : (
        <DiceReveal
          faces={faces}
          result={neighborhoodName(held.result)}
          tumble={tumble}
          announce={copy('creator.roll.reveal', { neighborhood: neighborhoodName(held.result) })}
          onLanded={() => setLanded(true)}
        />
      )}
      <p className="text-xs text-muted">{copy('creator.roll.once')}</p>
      {failed ? <p className="text-sm text-danger">{copy('creator.roll.failed')}</p> : null}
    </section>
  )
}
