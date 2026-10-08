'use client'

import { useModalOpen } from '@/components/overlay/modalState'
// Read directly (validated by CreatorConfigSchema in the data tests): the engine config would
// bring the whole balance into this small, precached chunk.
import creatorJson from '@data/config/creator.json'
import { creatorOfferShowing } from '@/engine/creator'
import { copy } from '@/lib/copy'
import { openCreator } from '@/state/creatorOpen'
import { dismissOffer } from '@/state/creatorOffer'
import { useGameStore } from '@/state/store'
import { useTourActive } from '@/state/tourActive'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/creatorOffer'

const BUTTON =
  'min-h-11 min-w-11 shrink-0 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The creator offer (S16a) in the toast zone: after the player's first action, and only once the
 * S06 tour is over (engine `creatorOfferShowing`), "Make it you" or "Not now". Either closes the
 * offer for good; the HUD's Your look (More on phones) opens the creator at any time. It never
 * takes focus or times out (it asks a question), steps aside while a level-up toast has the zone
 * or a modal is open, and is not part of the GR-9 start (it comes after the first action).
 */
declare global {
  interface Window {
    /** e2e only (tests/e2e/fixtures/test.ts `creatorOffer`): `off` keeps the offer away. */
    __CLOUTCITY_E2E_CREATOR_OFFER__?: 'off'
  }
}

/** True in a test-hook build whose e2e fixture turned the offer off. */
const offerOffForTests = () =>
  process.env.NEXT_PUBLIC_TEST_HOOKS === '1' && window.__CLOUTCITY_E2E_CREATOR_OFFER__ === 'off'

export function CreatorOffer() {
  const creator = useGameStore((state) => state.creator)
  const levelUp = useGameStore((state) => state.lastLevelUp)
  const tourActive = useTourActive()
  const modalOpen = useModalOpen()
  if (!creatorOfferShowing(creator, { tourActive }, { creator: creatorJson })) return null
  if (levelUp !== null || modalOpen || offerOffForTests()) return null

  const open = () => {
    dismissOffer()
    openCreator()
  }
  return (
    <div
      data-creator-offer=""
      data-cc-feature="cc-feature:creator-offer"
      data-cc-notice="creator-offer"
      className="mx-2 flex items-center gap-2 rounded-2xl border border-taxi glass px-3 py-1 shadow-lg"
    >
      <p className="min-w-0 flex-1 text-xs leading-tight text-fg">
        <strong className="font-extrabold text-taxi-ink">{copy('creatorOffer.title')}</strong>{' '}
        {copy('creatorOffer.body')}
      </p>
      <button
        type="button"
        onClick={open}
        aria-label={copy('creatorOffer.label')}
        className={`${BUTTON} bg-taxi text-on-taxi`}
      >
        {copy('creatorOffer.open')}
      </button>
      <button
        type="button"
        onClick={() => dismissOffer()}
        className={`${BUTTON} bg-raised text-fg`}
      >
        {copy('creatorOffer.skip')}
      </button>
    </div>
  )
}
