'use client'

/**
 * Whether a modal is open over the overlay (UX-1). A modal component declares itself with
 * `useModalPresence(open)`; the overlay background reads `useModalOpen()` to make the scene and
 * every zone inert and dimmed behind it. Generic, so later dialogs (S06, S19) reuse it.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

interface ModalState {
  /** How many modals are open now. */
  readonly openCount: number
}

export const modalStore = createStore<ModalState>()(() => ({ openCount: 0 }))

const isOpen = () => modalStore.getState().openCount > 0
const serverIsOpen = () => false

/** True while any modal is open. False during the server render and hydration. */
export function useModalOpen(): boolean {
  return useSyncExternalStore(modalStore.subscribe, isOpen, serverIsOpen)
}

/** Marks a modal as open for as long as `open` is true and the caller stays mounted. */
export function useModalPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return
    modalStore.setState((state) => ({ openCount: state.openCount + 1 }))
    return () => modalStore.setState((state) => ({ openCount: state.openCount - 1 }))
  }, [open])
}
