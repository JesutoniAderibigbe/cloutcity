/**
 * Closing the creator offer (S16a), shared by the offer toast and the creator's store actions.
 * Its own module so the offer's chunk takes only this and the engine's tiny state helper, not the
 * creator's flow and config (src/state/creatorActions.ts).
 */
import { dismissCreatorOffer } from '@/engine/creator'
import { gameStore, type GameStore } from './store'

/** The player closed the offer, or opened the creator from it; the HUD still opens it. */
export function dismissOffer(store: GameStore = gameStore): void {
  const { creator, clock } = store.getState()
  store.setState({ creator: dismissCreatorOffer(creator, clock.minute) })
}
