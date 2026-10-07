'use client'

import { useEffect, useRef, useState } from 'react'
// Read directly (validated by LayoutConfigSchema in src/lib/data/data.test.ts): the classic-zod
// loader in src/lib/data/config.ts must stay out of client chunks.
import layoutJson from '@data/config/layout.json'
import type { LevelUp } from '@/engine/clout'
import { copy } from '@/lib/copy'
import { levelUpCloseLabel, levelUpMessage, levelUpTitle, levelUpUnlocked } from '@/lib/levelUpCopy'
import { gameStore, useGameStore } from '@/state/store'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/clout'

/**
 * The level-up toast (S13), in the overlay toast zone, whose live region announces it. It
 * never takes focus (play carries on under it), closes itself after `overlay.toastMs`, and has
 * a Close button. While the pointer is over it or focus is inside it, the timer is paused
 * (WCAG 2.2.1); it restarts in full when both leave. Its one pop animation is off under
 * reduced motion (globals.css).
 */
export function LevelUpToast() {
  const levelUp = useGameStore((state) => state.lastLevelUp)
  if (levelUp === null) return null
  // Keyed per level-up, so a new one starts with a fresh timer and no stale hover or focus.
  return <Toast key={`${levelUp.to}@${levelUp.at}`} levelUp={levelUp} />
}

function Toast({ levelUp }: { readonly levelUp: LevelUp }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

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
    const timer = window.setTimeout(
      () => gameStore.getState().dismissLevelUp(),
      layoutJson.overlay.toastMs,
    )
    return () => window.clearTimeout(timer)
  }, [paused])

  const unlocked = levelUpUnlocked(levelUp)
  return (
    <div
      ref={ref}
      data-level-up={levelUp.to}
      data-cc-feature="cc-feature:level-up"
      data-cc-notice="level-up"
      data-paused={paused ? '' : undefined}
      className="level-up-pop mx-2 flex items-center gap-2 rounded-2xl border border-pink-400 bg-night-900/95 px-3 py-1 shadow-lg"
    >
      {/* Title and message share one flow so the longest level-up (every unlock on the way to
          Icon) still fits the 72 px toast zone at 390 px (UX-1). */}
      <div className="min-w-0 flex-1 text-xs leading-tight">
        <p>
          <strong className="font-extrabold text-pink-400">{levelUpTitle(levelUp)}</strong>{' '}
          <span className="text-ink-50">{levelUpMessage(levelUp)}</span>
        </p>
        {unlocked === null ? null : <p className="text-taxi-400">{unlocked}</p>}
      </div>
      <button
        type="button"
        onClick={() => gameStore.getState().dismissLevelUp()}
        aria-label={levelUpCloseLabel(levelUp)}
        className="min-h-11 min-w-11 shrink-0 rounded-xl bg-night-800 px-3 text-sm font-semibold text-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400"
      >
        {copy('clout.levelUp.close')}
      </button>
    </div>
  )
}
