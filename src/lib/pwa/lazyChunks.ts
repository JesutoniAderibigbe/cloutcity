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
  // The Blender landmarks' level loader (S07c, src/scene/models/landmarkLevels.ts): it only
  // runs once the model runtime has, and the levels themselves are never precached.
  { id: 'landmark-levels', marker: 'landmark levels: ' },
  // The /dev/models showcase (S04h).
  { id: 'model-showcase', marker: 'cc-feature:model-showcase' },
  // The apartment's 3D room (S16/S40, ApartmentCanvas.tsx): decoration over the Home panel,
  // whose lists do everything without it; offline before it was ever cached the room stays shut
  // (ApartmentMount's boundary) and the city keeps the screen.
  { id: 'apartment-scene', marker: 'cc-feature:apartment-scene' },
  // The apartment's decor models (src/scene/apartment/decorModels.ts), once the room is up.
  { id: 'apartment-decor-models', marker: 'apartment decor models: ' },
  // The finishes' looks and the room's palette (data/homes/finishes.json with theme.json), which
  // only the 3D room and buy mode read: the bundler splits them into a chunk of their own, so
  // the marker is a value only finishes.json holds (a floor's pattern; the engine's derived copy
  // has no patterns).
  { id: 'home-finishes', marker: 'pattern:"herringbone"' },
  // Buy mode 2.0 (S40, src/components/hud/HomeDecor.tsx): the furniture lists, catalogue and
  // finishes; offline before it was ever cached, the Home panel says so and rest and moves work.
  { id: 'home-decor', marker: 'cc-feature:home-decor' },
  // Street props (S04i, src/scene/props/layer.ts): mid and high only, once the camera zooms in.
  { id: 'street-props', marker: 'street props: ' },
  // The living city (S04l, src/scene/ambient/AmbientLife.tsx): after the map is playable.
  { id: 'ambient-life', marker: 'ambient life: ' },
  // Its pedestrian kit bakers (src/scene/ambient/pedestrianKits.ts), loaded by it on demand.
  { id: 'ambient-pedestrians', marker: 'pedestrian part has no skinned mesh' },
  // The street chains' loader and placement (src/scene/streets/loadStreets.ts), which the bundler
  // may split into a chunk the street props and the living city share.
  { id: 'streets', marker: 'invalid streets file' },
  // The look runtime (S16a): the full look options and derived avatar refs (resolveLook.ts), with
  // the map avatar's model chunk, the room avatar and the creator preview.
  { id: 'avatar-look', marker: 'resolveLook: unknown option' },
  // The full look options and traits (src/engine/creatorConfig.ts), which the bundler may split
  // into a chunk the look runtime and the creator share (`colorSlot` is only in options.json).
  { id: 'look-options', marker: 'colorSlot' },
  // The creator's avatar preview canvas (S16a, AvatarPreviewCanvas.tsx).
  { id: 'avatar-preview', marker: 'preview-avatar' },
  // The "Make it you" creator (S16a A3): its modal and steps (opened by signing up, DEC-62, or
  // from the HUD).
  { id: 'creator', marker: 'data-creator-progress' },
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
  // Accounts (S19, DEC-62): the sign-up and log-in screens and the Me tab's account section need
  // the network (and supabase-js), so an offline player gains nothing from them installed (a
  // returning player plays offline without them). The marker is a key of the `account` copy
  // namespace, which every one of those chunks carries and no boot chunk does.
  { id: 'account', marker: 'account.auth.tabSignup' },
  // The account calls and the account coordinator, which run only online.
  { id: 'account-api', marker: '/api/auth/login' },
  { id: 'account-notices', marker: 'cc-feature:account-notices' },
  // The Me panel (S18a/S18b/S19): the handle, public card, blocked and muted lists and the
  // account, all server data. Opened offline before it was ever cached, the Me tab shows the
  // island's load-failure retry instead of its own offline line; play is untouched.
  { id: 'me-panel', marker: 'cc-feature:me-panel' },
  // The Phone tab (S58): its home screen and every app screen (`cc-feature:phone-<app>`), opened
  // by the player; the map plays without them.
  { id: 'phone', marker: 'cc-feature:phone' },
  // The `phone` copy namespace, which the bundler may split from the screens that render it (a
  // key only data/copy/phone holds).
  { id: 'phone-copy', marker: 'phone.shop.premiumTitle' },
  // The Shop tab's store directory (S58).
  { id: 'shop-directory', marker: 'cc-feature:shop-directory' },
  // The Updates inbox's rules (src/lib/phone/updates.ts), shared by the home screen's badge and
  // the Updates app (an item kind only that module names).
  { id: 'phone-updates', marker: 'rent-owed' },
] as const

/** The markers an optional chunk's text contains (empty: precache it). */
export function optionalChunkMarkers(text: string): string[] {
  return OPTIONAL_CHUNK_MARKERS.filter(({ marker }) => text.includes(marker)).map(({ id }) => id)
}

/** Whether a URL or build path names a JS chunk (`.../static/chunks/....js`). */
export function isChunkPath(path: string): boolean {
  return /(?:^|\/)static\/chunks\/[^?#]+\.js$/.test(path)
}
