/**
 * Test-mode hook for the e2e suite: the live mixer on `window.__CLOUTCITY_TEST__.audio`. Only
 * builds with NEXT_PUBLIC_TEST_HOOKS=1 (inlined at build time; the e2e build sets it and writes
 * to its own distDir) install it. In every other build the body is dead code and is removed, so
 * the hook never ships. Imported only by the lazy audio runtime.
 */
import type { SfxId } from './channels'
import type { Gains } from './mixer'

export interface AudioTestHook {
  contextState(): string
  /** Gain values the graph applies right now. */
  gains(): Gains
  /** Gains the mixer computed from the stores (exact). */
  targetGains(): Gains
  /** Ids of the music and ambience tracks playing, or null. */
  playing(): { music: string | null; ambience: string | null }
  /** How many sound effects have started. */
  sfxStarted(): number
  playSfx(id: SfxId): void
}

declare global {
  interface Window {
    // At S04a integration this merges with the scene hook's declaration into one
    // `{ scene?: SceneTestHook; audio?: AudioTestHook }` (OPEN-ISSUES INT-4).
    __CLOUTCITY_TEST__?: { scene?: unknown; audio?: AudioTestHook }
  }
}

export function installAudioTestHook(hook: AudioTestHook): void {
  if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
  window.__CLOUTCITY_TEST__ = { ...window.__CLOUTCITY_TEST__, audio: hook }
}
