'use client'

/**
 * Sound settings (S05b): "My own music" and one volume per channel plus master, applied live.
 * A non-modal region (a labelled <section>) in the sheet zone; Escape or the close button
 * closes it and focus goes back to the gear. Opening it never starts audio; changing a setting
 * while sound is still off is a deliberate tap, so it also turns sound on (GR-13). A feature
 * island: it loads on the first gear tap (SoundSheetMount).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { MIXER_CHANNELS, type MixerChannel } from '@/lib/audio/channels'
import { audioConfig } from '@/lib/audio/config'
import { isOwnMusic, setOwnMusic } from '@/lib/audio/controls'
import { unlockAudioFromGesture } from '@/lib/audio/unlock'
import { copy, type CopyKey } from '@/lib/copy'
import { formatPercent } from '@/lib/format'
import { audioSettingsStore } from '@/state/audioSettings'
import { audioStatusStore } from '@/state/audioStatus'
import { onboardingStore } from '@/state/onboarding'
import { SOUND_SETTINGS_SHEET_ID, closeSoundSheet } from './soundSheet'
import '@/lib/copy/ns/audio'

const LABEL: Readonly<Record<MixerChannel, CopyKey>> = {
  master: 'audio.settings.master',
  music: 'audio.settings.music',
  sfx: 'audio.settings.sfx',
  ambience: 'audio.settings.ambience',
  voice: 'audio.settings.voice',
}

const TITLE_ID = 'sound-settings-title'
const HINT_ID = 'sound-settings-own-music-hint'

const volumesNow = () => audioSettingsStore.getState().volumes
const defaultVolumes = () => audioConfig.defaults
const ownMusicNow = () => isOwnMusic(onboardingStore.getState().record)
const never = () => false

/** Turns sound on if it is not running yet; a no-op once it is. */
function unlockIfLocked(): void {
  const { status } = audioStatusStore.getState()
  if (status === 'locked' || status === 'suspended' || status === 'interrupted') {
    unlockAudioFromGesture()
  }
}

export function SoundSettingsSheet() {
  const volumes = useSyncExternalStore(audioSettingsStore.subscribe, volumesNow, defaultVolumes)
  const ownMusic = useSyncExternalStore(onboardingStore.subscribe, ownMusicNow, never)
  const region = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    title.current?.focus()
    const element = region.current
    if (element === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSoundSheet()
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <section
      ref={region}
      id={SOUND_SETTINGS_SHEET_ID}
      aria-labelledby={TITLE_ID}
      data-cc-feature="cc-feature:sound-settings"
      className="flex min-h-full flex-col gap-3 rounded-t-3xl border border-night-700 bg-night-900 p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2
          ref={title}
          id={TITLE_ID}
          tabIndex={-1}
          className="text-lg font-extrabold text-pink-400 focus:outline-none"
        >
          {copy('audio.settings.title')}
        </h2>
        <button
          type="button"
          onClick={closeSoundSheet}
          aria-label={copy('audio.settings.close')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-xl text-ink-50 focus-visible:outline-2 focus-visible:outline-taxi-400"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink-50">
          <input
            type="checkbox"
            checked={ownMusic}
            aria-describedby={HINT_ID}
            onChange={(event) => {
              unlockIfLocked()
              setOwnMusic(event.target.checked)
            }}
            className="h-6 w-6 shrink-0 accent-[var(--color-taxi-400)]"
          />
          {copy('audio.settings.ownMusic')}
        </label>
        <p id={HINT_ID} className="text-sm text-ink-300">
          {copy('audio.settings.ownMusicHint')}
        </p>
      </div>

      {MIXER_CHANNELS.map((channel) => {
        const id = `sound-volume-${channel}`
        return (
          <div key={channel} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm text-ink-50">
              <label htmlFor={id} className="font-semibold">
                {copy(LABEL[channel])}
              </label>
              <output htmlFor={id} className="tabular-nums text-ink-300">
                {formatPercent(volumes[channel])}
              </output>
            </div>
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={audioConfig.volumeStep}
              value={volumes[channel]}
              onChange={(event) => {
                unlockIfLocked()
                audioSettingsStore
                  .getState()
                  .setVolume(channel, Number(event.target.value), Date.now())
              }}
              className="min-h-11 w-full accent-[var(--color-taxi-400)]"
            />
          </div>
        )
      })}
    </section>
  )
}
