/**
 * The presence loop (S42 phase 1): while the page is visible, a signed-in player with an account
 * announces where they are every `beatIntervalMs` and as soon as their spot changes (no sooner
 * than the server's rate limit allows), and every viewer reads who is online every
 * `snapshotIntervalMs`. A guest (an anonymous session) reads but never announces; a signed-out
 * visitor reads the cached public view. Failures back off exponentially up to `backoffMaxMs` and
 * never surface as errors: the map just goes quiet (CLAUDE.md "never blocks play").
 *
 * Hidden tab: no calls at all (the server drops the player after its online TTL). Visible again:
 * an immediate beat and read. Stop (sign-out, unmount): one best-effort leave.
 */
import { log } from '@/lib/log'
import type { RealtimeConfig } from '@/lib/data/schemas/config'
import type { Announce, PresenceSnapshot, PresenceTransport, PublicSnapshot } from './types'

/** `announce`: an account (beats and reads); `view`: a guest (reads); `public`: signed out. */
export type PresenceMode = 'announce' | 'view' | 'public'

export interface PresenceClientOptions {
  readonly transport: PresenceTransport
  readonly config: RealtimeConfig['presence']
  /** Who this device is now (it changes on sign-in and sign-out; call `kick` then). */
  readonly mode: () => PresenceMode
  /** Where the player is now, or null before the save has been read. */
  readonly announce: () => Announce | null
  readonly onSnapshot: (snapshot: PresenceSnapshot) => void
  readonly onPublic: (snapshot: PublicSnapshot) => void
  /** Reads failed this many times in a row (0 after a success). */
  readonly onFailures: (failures: number) => void
}

export interface PresenceClient {
  start(): void
  /** Stops every timer and, when this device announced, takes the player off the map. */
  stop(): void
  setVisible(visible: boolean): void
  /** The spot or the mode changed: announce (and read) as soon as allowed. */
  kick(): void
}

const sameAnnounce = (a: Announce | null, b: Announce | null) =>
  a !== null && b !== null && a.spot === b.spot && a.place === b.place && a.borough === b.borough

export function createPresenceClient(options: PresenceClientOptions): PresenceClient {
  const { transport, config } = options
  const minBeatGapMs = Math.ceil(60_000 / config.beatsPerMinute)
  let running = false
  let visible = true
  let readTimer: ReturnType<typeof setTimeout> | undefined
  let beatTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let lastBeatAt = -Infinity
  let lastAnnounced: Announce | null = null
  let announced = false
  let reading = false

  const clear = () => {
    clearTimeout(readTimer)
    clearTimeout(beatTimer)
    readTimer = undefined
    beatTimer = undefined
  }

  const backoff = (base: number) =>
    Math.min(config.backoffMaxMs, base * 2 ** Math.max(0, failures - 1))

  function scheduleRead(delayMs: number) {
    clearTimeout(readTimer)
    if (!running || !visible) return
    readTimer = setTimeout(() => void read(), delayMs)
  }

  async function read() {
    if (!running || !visible || reading) return
    reading = true
    const mode = options.mode()
    const result = mode === 'public' ? await transport.publicSnapshot() : await transport.snapshot()
    reading = false
    if (!running) return
    if (result.ok) {
      failures = 0
      if (mode === 'public') options.onPublic(result.data as PublicSnapshot)
      else options.onSnapshot(result.data as PresenceSnapshot)
    } else {
      failures++
      log.info('presence: read failed', { code: result.code, failures })
    }
    options.onFailures(failures)
    scheduleRead(failures === 0 ? config.snapshotIntervalMs : backoff(config.snapshotIntervalMs))
  }

  function scheduleBeat(delayMs: number) {
    clearTimeout(beatTimer)
    if (!running || !visible || options.mode() !== 'announce') return
    beatTimer = setTimeout(() => void beat(), Math.max(0, delayMs))
  }

  async function beat() {
    if (!running || !visible || options.mode() !== 'announce') return
    const where = options.announce()
    if (where === null) {
      scheduleBeat(config.beatIntervalMs)
      return
    }
    lastBeatAt = Date.now()
    const result = await transport.beat(where)
    if (!running) return
    if (result.ok) {
      announced = true
      lastAnnounced = where
      scheduleBeat(config.beatIntervalMs)
    } else {
      log.info('presence: beat refused', { code: result.code })
      // Guests, missing handles and sanctions are answers, not outages: try again much later.
      scheduleBeat(
        result.code === 'rate_limited'
          ? minBeatGapMs
          : Math.max(config.beatIntervalMs, minBeatGapMs) * 4,
      )
    }
  }

  /** Beats now, or as soon as the rate limit allows. */
  function beatSoon() {
    scheduleBeat(lastBeatAt + minBeatGapMs - Date.now())
  }

  return {
    start() {
      if (running) return
      running = true
      failures = 0
      beatSoon()
      scheduleRead(0)
    },
    stop() {
      if (!running) return
      running = false
      clear()
      if (announced) {
        announced = false
        lastAnnounced = null
        void transport.leave()
      }
    },
    setVisible(next) {
      if (visible === next) return
      visible = next
      if (!running) return
      if (!visible) {
        clear()
        return
      }
      beatSoon()
      scheduleRead(0)
    },
    kick() {
      if (!running || !visible) return
      if (options.mode() !== 'announce') {
        if (announced) {
          announced = false
          lastAnnounced = null
          void transport.leave()
        }
        clearTimeout(beatTimer)
        scheduleRead(0)
        return
      }
      if (!sameAnnounce(lastAnnounced, options.announce())) beatSoon()
    },
  }
}
