import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { T0, YEAR, answerWelcomeCard, welcomeDialog } from './fixtures/welcome'

// GR-13 / CLAUDE.md "Sound is the player's choice": no AudioContext is created and no audio is
// requested before the audio choice. S05a only records the choice (S05b plays it), so nothing
// audio-related happens after it either.

test.use({ onboarding: 'fresh' })

interface AudioProbe {
  contexts: number
  mediaElements: number
  plays: number
}

/** Counts every way a page can start audio. Silent: it never logs. */
async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { contexts: 0, mediaElements: 0, plays: 0 }
    Object.defineProperty(window, '__audioProbe', { value: probe })
    const w = window as unknown as Record<string, unknown>
    for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
      const Original = w[name] as (new (...args: unknown[]) => object) | undefined
      if (typeof Original !== 'function') continue
      w[name] = class extends Original {
        constructor(...args: unknown[]) {
          super(...args)
          probe.contexts += 1
        }
      }
    }
    const OriginalAudio = window.Audio
    window.Audio = class extends OriginalAudio {
      constructor(src?: string) {
        super(src)
        probe.mediaElements += 1
      }
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      probe.plays += 1
      return play.call(this)
    }
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLMediaElement) probe.mediaElements += 1
          if (node instanceof Element)
            probe.mediaElements += node.querySelectorAll('audio, video').length
        }
      }
    }).observe(document, { childList: true, subtree: true })
  })
}

const AUDIO_PATH = /\/audio\/|\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|weba)(\?|$)/i

function trackAudioRequests(page: Page): string[] {
  const found: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'media' || AUDIO_PATH.test(request.url())) {
      found.push(request.url())
    }
  })
  page.on('response', (response) => {
    const type = response.headers()['content-type'] ?? ''
    if (type.startsWith('audio/')) found.push(`${response.url()} (${type})`)
  })
  return found
}

const probeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __audioProbe: AudioProbe }).__audioProbe)

const SILENT: AudioProbe = { contexts: 0, mediaElements: 0, plays: 0 }

for (const audio of ['Play our music', "I'll bring my own"] as const) {
  test(`no audio before or after choosing "${audio}"`, async ({ page }) => {
    await installAudioProbe(page)
    const requests = trackAudioRequests(page)
    await page.clock.setFixedTime(T0)
    await page.goto('/')
    await expect(welcomeDialog(page)).toBeVisible()

    // Interacting with the card is a user gesture, the moment autoplay rules would allow audio.
    await welcomeDialog(page).getByRole('radio', { name: audio }).check()
    expect(await probeOf(page)).toEqual(SILENT)
    expect(requests).toEqual([])

    await answerWelcomeCard(page, { birthYear: YEAR - 30, consent: true, audio })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await probeOf(page)).toEqual(SILENT)
    expect(requests).toEqual([])
  })
}

test('the probe itself sees an AudioContext and an <audio> element (self-check)', async ({
  page,
}) => {
  await installAudioProbe(page)
  await page.goto('/')
  await page.evaluate(() => {
    void new AudioContext().close()
    document.body.append(document.createElement('audio'))
  })
  await expect.poll(() => probeOf(page)).toEqual({ contexts: 1, mediaElements: 1, plays: 0 })
})
