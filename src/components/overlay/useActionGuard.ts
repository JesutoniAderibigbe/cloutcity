'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import layoutJson from '@data/config/layout.json'
import type { LayoutConfig } from '@/lib/data/schemas/config'

// Read directly rather than through src/lib/data/config.ts (or ./layers, which uses it), so
// browser code stays off classic zod (src/lib/client-imports.test.ts). LayoutConfigSchema
// validates the file in src/lib/data/data.test.ts.
const layout: LayoutConfig = layoutJson

/**
 * A button's `onKeyDown`: a held Enter or Space auto-repeats keydown, and each repeated Enter
 * would activate the focused button again. Cancelling the repeats means a held key activates
 * exactly once.
 */
export function ignoreKeyRepeat(event: KeyboardEvent<HTMLElement>): void {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
}

export interface ActionGuard {
  /**
   * Wraps a button's click: runs `action` only when the guard lets the activation through.
   * `target` names what the button acts on (an item id), so a repeat on the same thing is told
   * apart from a tap that reached a different row.
   */
  readonly guard: (event: MouseEvent<HTMLElement>, target: string, action: () => void) => void
  /** Each guarded button's `onKeyDown`: {@link ignoreKeyRepeat}. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  /** True while the pointer cooldown runs; put it on the action list as `aria-busy`. */
  readonly coolingDown: boolean
}

interface LastTap {
  readonly target: string
  readonly rect: DOMRect
  readonly until: number
}

const inside = (rect: DOMRect, x: number, y: number) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

/**
 * Guards a panel's action buttons (S10a) against taps that were not meant for the action now
 * under them. An action can swap its button in place (Wear becomes Take off) or remove its row
 * (the next row's button slides under the finger), so:
 * - a key held down activates once;
 * - the second click of a double click (`detail > 1`) is ignored;
 * - while the last action settles (until the frame after it commits), every activation is
 *   ignored;
 * - for `layout.json overlay.actionCooldownMs` after an action, a pointer tap is ignored when it
 *   lands where the tapped button was but on a different target: the drifting second tap of a
 *   double tap (two `detail === 1` taps) that would hit the row that slid in. A deliberate tap
 *   elsewhere, or again on the same target (selling a second copy from a stack), still acts.
 *   Keyboard activations (`detail === 0`) are never delayed.
 * Buttons stay enabled throughout, so focus is never dropped.
 */
export function useActionGuard(): ActionGuard {
  const cooldownMs = layout.overlay.actionCooldownMs
  const busy = useRef(false)
  const last = useRef<LastTap | null>(null)
  const [runs, setRuns] = useState(0)
  const [coolingDown, setCoolingDown] = useState(false)

  // Released on the frame after the action's state change commits (the effect runs after it).
  useEffect(() => {
    if (runs === 0) return
    const frame = requestAnimationFrame(() => {
      busy.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [runs])

  // Restarts with every action, so the list stays busy until the last cooldown ends.
  useEffect(() => {
    if (runs === 0) return
    const timer = setTimeout(() => setCoolingDown(false), cooldownMs)
    return () => clearTimeout(timer)
  }, [runs, cooldownMs])

  const guard = (event: MouseEvent<HTMLElement>, target: string, action: () => void) => {
    if (busy.current || event.detail > 1) return
    const pointer = event.detail > 0
    const previous = last.current
    if (
      pointer &&
      previous !== null &&
      performance.now() < previous.until &&
      previous.target !== target &&
      inside(previous.rect, event.clientX, event.clientY)
    ) {
      return
    }
    busy.current = true
    const rect = event.currentTarget.getBoundingClientRect()
    try {
      action()
    } catch (error) {
      busy.current = false
      throw error
    }
    last.current = { target, rect, until: performance.now() + cooldownMs }
    setCoolingDown(true)
    setRuns((count) => count + 1)
  }

  return { guard, onKeyDown: ignoreKeyRepeat, coolingDown }
}
