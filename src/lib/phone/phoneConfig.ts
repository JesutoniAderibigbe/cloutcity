/**
 * data/config/phone.json (S58). Client code: the JSON is read directly and typed with a cast
 * (its schema, PhoneConfigSchema, runs in src/lib/data/data.test.ts, which gates every build),
 * so no classic zod ships with the phone.
 */
import phoneJson from '@data/config/phone.json'
import type { PhoneAppId, PhoneConfig } from '@/lib/data/schemas/config'

export const phoneConfig = phoneJson as PhoneConfig

export type { PhoneAppId }

/**
 * What tapping an app does: open its screen inside the phone (`screen`), open a HUD panel in
 * the phone's place (`panel`, and its Close comes back to the phone), or open the Places panel.
 */
export type PhoneAppTarget =
  | { readonly kind: 'screen' }
  | { readonly kind: 'panel'; readonly panel: 'goals' | 'inventory' | 'home' | 'me' }
  | { readonly kind: 'places' }

export const PHONE_APP_TARGETS: Readonly<Record<PhoneAppId, PhoneAppTarget>> = {
  bank: { kind: 'screen' },
  updates: { kind: 'screen' },
  jobs: { kind: 'screen' },
  places: { kind: 'places' },
  goals: { kind: 'panel', panel: 'goals' },
  closet: { kind: 'panel', panel: 'inventory' },
  home: { kind: 'panel', panel: 'home' },
  profile: { kind: 'panel', panel: 'me' },
  messages: { kind: 'screen' },
  settings: { kind: 'screen' },
}

/** The screen the `?` key asks for (src/components/nav/BottomTabs.tsx SHORTCUTS_APP). */
export const SHORTCUTS_SCREEN = 'shortcuts'

/** The app a requested phone screen belongs to (`shortcuts` is a part of Settings & Help). */
export function phoneAppOf(screen: string | null): PhoneAppId | null {
  if (screen === null) return null
  if (screen === SHORTCUTS_SCREEN) return 'settings'
  return phoneConfig.apps.some((app) => app.id === screen) ? (screen as PhoneAppId) : null
}

/**
 * A badge's text (GR-21): the count up to `cap`, then "cap+"; never a "99+" flood. Null for
 * nothing new.
 */
export function badgeCount(
  count: number,
  cap: number,
): { readonly capped: boolean; readonly value: number } | null {
  if (count <= 0) return null
  return count > cap ? { capped: true, value: cap } : { capped: false, value: count }
}
