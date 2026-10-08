'use client'

import { copy } from '@/lib/copy'

/** The root attribute the clean-screen toggle (S58, Settings & Help) sets. */
export const CLEAN_SCREEN_ATTR = 'data-clean-screen'

/**
 * The way back from clean screen (S58): while the root carries `data-clean-screen`, globals.css
 * hides the HUD, banner and toasts and shows this button in the HUD row instead. Session-only,
 * so a reload always brings the HUD back. Boot copy (`nav`), since it ships in the shell.
 */
export function CleanScreenExit() {
  return (
    <div className="hidden h-full items-start justify-center pt-2" data-clean-screen-exit="">
      <button
        type="button"
        onClick={() => document.documentElement.removeAttribute(CLEAN_SCREEN_ATTR)}
        className="flex min-h-11 items-center gap-2 rounded-full border border-line glass px-4 text-sm font-semibold text-fg shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true">👁️</span>
        {copy('nav.showHud')}
      </button>
    </div>
  )
}
