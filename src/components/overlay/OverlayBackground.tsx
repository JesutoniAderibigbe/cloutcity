'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useModalOpen } from './modalState'

/**
 * The scene and every overlay zone. While a modal is open it is inert (no focus, clicks or
 * screen-reader access) and dimmed, but still mounted: the map keeps loading behind the modal.
 * When the last modal closes and focus went with it, focus moves to the scene's <main> so
 * keyboard and screen-reader users are not left on a removed element. Focus that something else
 * has already taken (a dialog restored behind the welcome island's loading card) stays put.
 */
export function OverlayBackground({ children }: { readonly children: ReactNode }) {
  const modalOpen = useModalOpen()
  const root = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    // Runs after the commit that removed `inert`, so <main> can take focus.
    const active = document.activeElement
    const focusLost = active === null || active === document.body
    if (wasOpen.current && !modalOpen && focusLost) root.current?.querySelector('main')?.focus()
    wasOpen.current = modalOpen
  }, [modalOpen])

  return (
    <div
      ref={root}
      data-overlay-background=""
      inert={modalOpen}
      className="absolute inset-0 inert:opacity-40 motion-safe:transition-opacity"
    >
      {children}
    </div>
  )
}
