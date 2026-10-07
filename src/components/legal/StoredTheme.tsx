'use client'

/**
 * On pages without the game clock (legal pages, credits): after mount, shows the interface
 * theme the game last showed (S04g, Q3), or keeps the server's day palette when there is none.
 * Instant: nothing on these pages moves.
 */
import { useEffect } from 'react'
import { UI_THEME_KEY } from '@/lib/uiThemeKey'

export function readStoredTheme(storage: Pick<Storage, 'getItem'>): 'day' | 'night' {
  try {
    return storage.getItem(UI_THEME_KEY) === 'night' ? 'night' : 'day'
  } catch {
    // Storage can be off (private mode): day, like the server rendered.
    return 'day'
  }
}

export function StoredTheme() {
  useEffect(() => {
    document.documentElement.dataset.theme = readStoredTheme(localStorage)
  }, [])
  return null
}
