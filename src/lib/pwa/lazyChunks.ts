/**
 * Large optional chunks the service worker does not precache on install (PERF-7): code a player
 * may never need, which the worker caches at runtime the first time it loads (src/sw/sw.ts
 * `cc-chunks-<revision>`, cache-first). A chunk is optional when its built text contains one of
 * these markers. Shared by the worker route's manifest filter (src/server/pwa/revision.ts) and
 * the budget's positive control (scripts/budget.ts), and never imported by client code: a marker
 * that reached a boot chunk would drop that chunk from the precache (the budget fails then, as
 * the path to playable must stay precached).
 */
export const OPTIONAL_CHUNK_MARKERS = [
  // The model runtime: three's glTF loader with the meshopt decoder (S04h), after the map draws.
  { id: 'model-runtime', marker: 'EXT_meshopt_compression' },
  // The /dev/models showcase (S04h).
  { id: 'model-showcase', marker: 'cc-feature:model-showcase' },
  // The apartment's decor models (src/scene/apartment/decorModels.ts), once the room is up.
  { id: 'apartment-decor-models', marker: 'apartment decor models: ' },
  // Street props (S04i, src/scene/props/layer.ts): mid and high only, once the camera zooms in.
  { id: 'street-props', marker: 'street props: ' },
  // The living city (S04l, src/scene/ambient/AmbientLife.tsx): after the map is playable.
  { id: 'ambient-life', marker: 'ambient life: ' },
  // The look runtime (S16a): the full look options and derived avatar refs (resolveLook.ts), with
  // the map avatar's model chunk, the room avatar and the creator preview.
  { id: 'avatar-look', marker: 'resolveLook: unknown option' },
  // The full look options and traits (src/engine/creatorConfig.ts), which the bundler may split
  // into a chunk the look runtime and the creator share (`colorSlot` is only in options.json).
  { id: 'look-options', marker: 'colorSlot' },
  // The creator's avatar preview canvas (S16a, AvatarPreviewCanvas.tsx).
  { id: 'avatar-preview', marker: 'preview-avatar' },
  // The "Make it you" creator (S16a A3): its modal and steps, opened by the player.
  { id: 'creator', marker: 'data-creator-progress' },
  // Its offer toast (shown once, after the first action; lazyIsland `hideFailure` offline).
  { id: 'creator-offer', marker: 'data-creator-offer' },
  // The creator's flow, config and copy, which the bundler may split from the modal (an error
  // code only src/engine/creatorFlow.ts holds).
  { id: 'creator-flow', marker: 'ROLL_DISABLED' },
  // The /mod console (S18b): moderators only; /mod itself is never precached.
  { id: 'mod-console', marker: 'data-mod-error' },
  // Pin icons and labels (S04k, src/scene/pins/PinMarks.tsx): after the map is playable; the
  // pins draw without them until the chunk arrives.
  { id: 'pin-marks', marker: 'cc-feature:pin-marks' },
  // supabase-js (S18): it only works online (sign-in, cloud saves, profiles, safety), so an
  // offline player gains nothing from having it installed; offline, the session stays local.
  { id: 'supabase-client', marker: 'GoTrueClient' },
  // Accounts (S19): the account sheet, the welcome card's log-in view, the save banner and nudge,
  // the Me tab's account section and /auth/callback all need the network (and supabase-js), so
  // an offline player gains nothing from them installed. The marker is a key of the `account`
  // copy namespace, which every one of those chunks carries and no boot chunk does.
  { id: 'account', marker: 'account.sheet.saveTitle' },
  // The account calls and the account coordinator (S19), which run only online, after sign-in.
  { id: 'account-api', marker: 'check_account_email' },
  // The moderator notices shown at session start (S18b): loaded only once a session connects, so
  // never offline.
  { id: 'account-notices', marker: 'cc-feature:account-notices' },
  // The Me panel (S18a/S18b/S19): the handle, public card, blocked and muted lists and the
  // account, all server data. Opened offline before it was ever cached, the Me tab shows the
  // island's load-failure retry instead of its own offline line; play is untouched.
  { id: 'me-panel', marker: 'cc-feature:me-panel' },
] as const

/** The markers an optional chunk's text contains (empty: precache it). */
export function optionalChunkMarkers(text: string): string[] {
  return OPTIONAL_CHUNK_MARKERS.filter(({ marker }) => text.includes(marker)).map(({ id }) => id)
}

/** Whether a URL or build path names a JS chunk (`.../static/chunks/....js`). */
export function isChunkPath(path: string): boolean {
  return /(?:^|\/)static\/chunks\/[^?#]+\.js$/.test(path)
}
