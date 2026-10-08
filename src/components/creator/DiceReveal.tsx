'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@/lib/useReducedMotion'

/** How long the dice tumble, and how often the face changes (ms). */
export const DICE_TUMBLE_MS = 1200
export const DICE_FACE_MS = 110

/**
 * A roll's reveal (S16a, D18), shared with S44's origin roll: the faces tumble through the pool
 * and land on the result that is already saved (the roll is committed before this shows, so a
 * reload lands on the same face). Under reduced motion it cuts straight to the result. The
 * tumbling faces are hidden from assistive tech; `announce` is read once the dice land.
 */
export function DiceReveal({
  faces,
  result,
  tumble,
  announce,
  onLanded,
}: {
  readonly faces: readonly string[]
  readonly result: string
  /** False: the result shows at once (an earlier roll, replayed). */
  readonly tumble: boolean
  readonly announce: string
  readonly onLanded?: () => void
}) {
  const reducedMotion = useReducedMotion()
  const animate = tumble && !reducedMotion && faces.length > 1
  const [tick, setTick] = useState(0)
  const [done, setDone] = useState(false)
  const landed = !animate || done

  useEffect(() => {
    if (!animate) return
    const faceTimer = window.setInterval(() => setTick((value) => value + 1), DICE_FACE_MS)
    const landTimer = window.setTimeout(() => {
      window.clearInterval(faceTimer)
      setDone(true)
    }, DICE_TUMBLE_MS)
    return () => {
      window.clearInterval(faceTimer)
      window.clearTimeout(landTimer)
    }
  }, [animate])

  // Tells the caller once the dice show the result (at once without a tumble).
  const told = useRef(false)
  useEffect(() => {
    if (!landed || told.current) return
    told.current = true
    onLanded?.()
  }, [landed, onLanded])

  const face = landed ? result : (faces[tick % faces.length] ?? result)
  return (
    <div data-dice-reveal={landed ? 'landed' : 'tumbling'} className="flex flex-col gap-1">
      <p
        aria-hidden="true"
        className="rounded-2xl border border-taxi bg-raised px-4 py-3 text-center text-lg font-extrabold text-fg"
      >
        {face}
      </p>
      <p role="status" className="min-h-5 text-sm font-semibold text-taxi-ink">
        {landed ? announce : null}
      </p>
    </div>
  )
}
