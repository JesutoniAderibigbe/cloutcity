'use client'

import { useEffect, useRef, useState } from 'react'
// Read directly (validated by LayoutConfigSchema in src/lib/data/data.test.ts): the classic-zod
// loader in src/lib/data/config.ts must stay out of client chunks.
import layoutJson from '@data/config/layout.json'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import type { RentEvent } from '@/engine/rent'
import { useGameStore } from '@/state/store'

// S41: the level-up text names what a level unlocked (boroughs, jobs, clubs), so it reads the
// places module and every venue and landmark name. It loads on the first level-up instead of
// with this boot island, keeping that copy off the path to playable (perf.json
// totalJsToPlayableGzKB). The store's level-up waits for it, so nothing is missed.
const LevelUpNotice = lazyIsland(
  () => import('./LevelUpNotice').then((module) => module.LevelUpNotice),
  { zone: 'toast', labelKey: 'loading.levelUp', quiet: true },
)

const RentToast = lazyIsland(() => import('./RentToast').then((module) => module.RentToast), {
  zone: 'toast',
  labelKey: 'loading.rentNotice',
  quiet: true,
})

/** Rent events that get their own toast: a miss and an eviction (a payment does not). */
function isRentAlarm(event: RentEvent | null): event is RentEvent {
  return event !== null && (event.kind === 'missed' || event.kind === 'evicted')
}

/**
 * The toast zone's host (S13): the level-up toast, else one rent notice when rent was just
 * missed or the player evicted, whether that happened during an action or on the passive clock.
 * One toast at a time; a rent notice shows once per rent event (its Close or timer retires it),
 * and a level-up arriving meanwhile takes the zone first. Both toasts load lazily (the rent toast
 * the first time rent is missed, the level-up toast on the first level-up), so the boot island
 * holds only these checks and the shared toast timer.
 */
export function LevelUpToast() {
  const levelUp = useGameStore((state) => state.lastLevelUp)
  const rent = useGameStore((state) => state.lastRentEvent)
  const [retired, setRetired] = useState<RentEvent | null>(null)
  // Keyed per level-up, so a new one starts with a fresh timer and no stale hover or focus.
  if (levelUp !== null) {
    return <LevelUpNotice key={`${levelUp.to}@${levelUp.at}`} levelUp={levelUp} />
  }
  if (!isRentAlarm(rent) || rent === retired) return null
  return (
    <RentToast key={`${rent.kind}@${rent.day}`} event={rent} onClose={() => setRetired(rent)} />
  )
}

/**
 * A toast's timer (S13): `onTimeout` runs after `overlay.toastMs`, paused while the pointer is
 * over the toast or focus is inside it (WCAG 2.2.1), restarting in full when both leave. The
 * returned ref goes on the toast; `paused` is for its `data-paused`.
 */
export function useToastTimer(onTimeout: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const timeout = useRef(onTimeout)
  useEffect(() => {
    timeout.current = onTimeout
  })

  // Listened to directly: jsx-a11y does not allow pointer or focus handlers on a static div.
  useEffect(() => {
    const toast = ref.current
    if (toast === null) return
    const enter = () => setHovered(true)
    const leave = () => setHovered(false)
    const focusIn = () => setFocused(true)
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && toast.contains(event.relatedTarget))) {
        setFocused(false)
      }
    }
    toast.addEventListener('pointerenter', enter)
    toast.addEventListener('pointerleave', leave)
    toast.addEventListener('focusin', focusIn)
    toast.addEventListener('focusout', focusOut)
    return () => {
      toast.removeEventListener('pointerenter', enter)
      toast.removeEventListener('pointerleave', leave)
      toast.removeEventListener('focusin', focusIn)
      toast.removeEventListener('focusout', focusOut)
    }
  }, [])

  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => timeout.current(), layoutJson.overlay.toastMs)
    return () => window.clearTimeout(timer)
  }, [paused])

  return { ref, paused }
}
