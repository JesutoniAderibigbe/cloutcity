'use client'

import layoutJson from '@data/config/layout.json'
import { useEffect, useRef, useState } from 'react'
import { copy } from '@/lib/copy'
import { dismissSafetyToast, useSafetyToast, type SafetyToast as Toast } from '@/state/safetyToast'
import { SAFETY_BUTTON } from './styles'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/safety'

/**
 * The safety toast (S18b) in the overlay toast zone, whose live region announces it. It never
 * takes focus. It offers Undo until the action's undo window ends, then closes itself after
 * `overlay.toastMs` (or the undo window, if longer); while the pointer or focus is on it the
 * close timer waits (WCAG 2.2.1). The undo window itself is the server's and does not wait.
 */
export function SafetyToast() {
  const toast = useSafetyToast()
  if (toast === null) return null
  return <ToastView key={toast.id} toast={toast} />
}

function ToastView({ toast }: { readonly toast: Toast }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const held = hovered || focused
  const [undoOpen, setUndoOpen] = useState(
    () => toast.undo !== null && toast.undo.untilMs > Date.now(),
  )

  // Listened to directly: jsx-a11y does not allow pointer or focus handlers on a static div.
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const enter = () => setHovered(true)
    const leave = () => setHovered(false)
    const focusIn = () => setFocused(true)
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) {
        setFocused(false)
      }
    }
    element.addEventListener('pointerenter', enter)
    element.addEventListener('pointerleave', leave)
    element.addEventListener('focusin', focusIn)
    element.addEventListener('focusout', focusOut)
    return () => {
      element.removeEventListener('pointerenter', enter)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('focusin', focusIn)
      element.removeEventListener('focusout', focusOut)
    }
  }, [])

  useEffect(() => {
    if (toast.undo === null || !undoOpen) return
    const timer = window.setTimeout(() => setUndoOpen(false), toast.undo.untilMs - Date.now())
    return () => window.clearTimeout(timer)
  }, [toast.undo, undoOpen])

  useEffect(() => {
    if (held) return
    const untilUndo = toast.undo === null ? 0 : toast.undo.untilMs - Date.now()
    const timer = window.setTimeout(
      () => dismissSafetyToast(toast.id),
      Math.max(layoutJson.overlay.toastMs, untilUndo),
    )
    return () => window.clearTimeout(timer)
  }, [held, toast])

  return (
    <div
      ref={ref}
      data-safety-toast=""
      data-cc-feature="cc-feature:safety-toast"
      className="mx-2 flex items-center gap-2 rounded-2xl border border-taxi-400 bg-night-900/95 px-3 py-1 shadow-lg backdrop-blur"
    >
      <p className="min-w-0 flex-1 text-xs leading-tight text-ink-50">{toast.text}</p>
      {toast.undo !== null && undoOpen ? (
        <button
          type="button"
          data-safety-undo=""
          aria-label={toast.undo.label}
          onClick={() => {
            toast.undo?.run()
            setUndoOpen(false)
          }}
          className={`${SAFETY_BUTTON} shrink-0 bg-taxi-400 text-night-950`}
        >
          {copy('safety.toast.undo')}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={copy('safety.toast.closeLabel')}
        onClick={() => dismissSafetyToast(toast.id)}
        className={`${SAFETY_BUTTON} shrink-0 bg-night-800 text-ink-50`}
      >
        {copy('safety.toast.close')}
      </button>
    </div>
  )
}
