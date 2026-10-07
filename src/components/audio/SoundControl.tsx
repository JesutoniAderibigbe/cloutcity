'use client'

/**
 * The HUD sound control (S05b). One tap toggles "My own music" (our music mutes; sound effects
 * and city sounds keep playing), and the second line says what is playing. Before audio is
 * unlocked it reads "Tap for sound" with the remembered choice, and that first tap only turns
 * sound on (GR-13). If music (or the whole runtime) failed to load, it says so and a tap retries.
 * The gear opens the sound settings.
 *
 * A boot island (SoundControlMount): it and the zod-backed stores it reads load in their own
 * chunk right after the shell (DEC-11).
 */
import { useSyncExternalStore } from 'react'
import { copy, isCopyKey } from '@/lib/copy'
import { isOwnMusic, toggleOwnMusic } from '@/lib/audio/controls'
import { nowPlaying, type NowPlaying } from '@/lib/audio/mixer'
import { playSfx } from '@/lib/audio/sfx'
import { retryAudio } from '@/lib/audio/loadRuntime'
import { unlockAudioFromGesture } from '@/lib/audio/unlock'
import { INITIAL_AUDIO_STATUS, audioStatusStore } from '@/state/audioStatus'
import { onboardingStore } from '@/state/onboarding'
import {
  SOUND_SETTINGS_BUTTON_ID,
  SOUND_SETTINGS_SHEET_ID,
  setSoundSheetOpen,
  soundSheetStore,
} from './soundSheet'
import '@/lib/copy/ns/audio'

const LINE_2_ID = 'sound-control-now-playing'

const ownMusicNow = () => isOwnMusic(onboardingStore.getState().record)
const statusNow = () => audioStatusStore.getState()
const sheetOpenNow = () => soundSheetStore.getState().open
const never = () => false
const initialStatus = () => INITIAL_AUDIO_STATUS

function secondLine(view: NowPlaying, ownMusic: boolean, titleKey: string | null): string {
  switch (view.kind) {
    case 'locked':
      return copy(ownMusic ? 'audio.hud.yourMusic' : 'audio.hud.modeOurs')
    case 'unsupported':
    case 'unavailable':
      return ''
    case 'off':
      return copy('audio.hud.off')
    case 'own':
      return copy('audio.hud.yourMusic')
    case 'loading':
      return copy('audio.hud.loading')
    case 'track':
      return titleKey !== null && isCopyKey(titleKey)
        ? copy('audio.hud.track', { title: copy(titleKey) })
        : copy('audio.hud.loading')
  }
}

const BUTTON =
  'flex min-h-11 min-w-11 items-center rounded-full border border-night-700 bg-night-800 text-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400 disabled:opacity-60'

export function SoundControl() {
  const ownMusic = useSyncExternalStore(onboardingStore.subscribe, ownMusicNow, never)
  const status = useSyncExternalStore(audioStatusStore.subscribe, statusNow, initialStatus)
  const sheetOpen = useSyncExternalStore(soundSheetStore.subscribe, sheetOpenNow, never)

  const view = nowPlaying({
    status: status.status,
    ownMusic,
    masterVolume: status.masterVolume,
    musicTrackId: status.musicTrackId,
    musicFailed: status.musicFailed,
    runtimeFailed: status.runtimeFailed,
  })
  const line2 = secondLine(view, ownMusic, status.musicTitleKey)

  const onMain = () => {
    // Synchronous, inside the tap: the first tap only turns sound on.
    if (view.kind === 'locked') {
      unlockAudioFromGesture()
      return
    }
    if (view.kind === 'unavailable') {
      retryAudio()
      return
    }
    toggleOwnMusic()
    playSfx('ui-tap')
  }

  const unavailableText =
    view.kind === 'unavailable'
      ? copy(view.what === 'music' ? 'audio.hud.musicUnavailable' : 'audio.hud.soundUnavailable')
      : ''
  const main =
    view.kind === 'unsupported'
      ? { 'aria-label': copy('audio.hud.unsupported'), disabled: true }
      : view.kind === 'unavailable'
        ? {}
        : view.kind === 'locked'
          ? { 'aria-label': copy('audio.hud.turnOn'), 'aria-describedby': LINE_2_ID }
          : {
              'aria-label': copy('audio.hud.ownMusic'),
              'aria-pressed': ownMusic,
              'aria-describedby': LINE_2_ID,
            }
  const line1 =
    view.kind === 'unsupported'
      ? copy('audio.hud.unsupported')
      : view.kind === 'unavailable'
        ? unavailableText
        : view.kind === 'locked'
          ? copy('audio.hud.tapForSound')
          : copy('audio.hud.ownMusic')

  return (
    <div
      className="flex min-w-0 shrink items-center gap-1.5"
      data-sound-control={view.kind}
      data-cc-feature="cc-feature:sound-control"
    >
      <button
        type="button"
        onClick={onMain}
        className={`${BUTTON} min-w-0 max-w-44 justify-center text-left aria-pressed:border-taxi-400 sm:flex-col sm:items-start sm:px-3 ${view.kind === 'locked' ? 'border-taxi-400 sm:border-night-700' : ''}`}
        {...main}
      >
        {/* Phone widths: the HUD row also holds the title and the clout meter, so the control
            is an icon; its two lines stay readable to screen readers and show from sm up. */}
        <SpeakerIcon
          on={view.kind !== 'locked' && view.kind !== 'unsupported' && view.kind !== 'off'}
        />
        <span className="sr-only sm:not-sr-only sm:block sm:max-w-full sm:truncate sm:text-xs sm:font-bold">
          {line1}
        </span>
        {line2 === '' ? null : (
          <span
            id={LINE_2_ID}
            className="sr-only sm:not-sr-only sm:block sm:max-w-full sm:truncate sm:text-[0.6875rem] sm:text-ink-300"
          >
            {line2}
          </span>
        )}
      </button>
      <button
        type="button"
        id={SOUND_SETTINGS_BUTTON_ID}
        aria-label={copy('audio.hud.settings')}
        aria-expanded={sheetOpen}
        aria-controls={sheetOpen ? SOUND_SETTINGS_SHEET_ID : undefined}
        onClick={() => setSoundSheetOpen(!sheetOpen)}
        className={`${BUTTON} shrink-0 justify-center`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-none stroke-current stroke-2"
        >
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" strokeLinecap="round" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
    </div>
  )
}

/** The phone-width face of the main button: a speaker, struck through while sound is off. */
function SpeakerIcon({ on }: { readonly on: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current stroke-2 sm:hidden"
    >
      <path d="M4 9h4l5-4v14l-5-4H4z" strokeLinejoin="round" />
      {on ? (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" />
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
      )}
    </svg>
  )
}
