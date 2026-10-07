/**
 * The "Make it you" creator's store actions (S16a). They live outside the game store so their
 * engine code (choices, rolls, moving in) loads with the creator's lazy island, not on the
 * playable path; the store itself only counts actions toward the offer (`noteCreatorAction`).
 * Each one calls the engine and writes the result to the store, like the store's own actions.
 */
import { chooseLook, randomLook, type Look, type LookResult } from '@/engine/appearance'
import { chooseCareer, type CareerResult } from '@/engine/career'
import { engineConfig } from '@/engine/config'
import {
  commitRoll,
  completeCreator,
  dismissCreatorOffer,
  moveIntoNeighborhood,
  skipCreatorStep,
  type MoveInResult,
  type RollResult,
} from '@/engine/creator'
import { syncGoals } from '@/engine/goals'
import { createRng } from '@/engine/rng'
import { chooseTraits, type TraitsResult } from '@/engine/traits'
import { randomSeed } from './randomSeed'
import { gameStore, levelUpPatch, persistedOf, type GameStore, type PersistedState } from './store'

export interface CreatorActions {
  /** Sets the look; only a complete look of known options is accepted. */
  chooseLook(look: unknown): LookResult
  /** A random look to preview ("Surprise me"); nothing changes until `chooseLook`. */
  surpriseLook(): Look
  /** Picks the traits (the change cooldown applies to a different pair). */
  chooseTraits(traitIds: readonly string[]): TraitsResult
  /** The Dream. An artist/DJ's home bonus can show the level-up toast. */
  chooseCareer(careerPath: string): CareerResult
  /**
   * Rolls the start neighborhood once per save. The result is saved before it is returned (the
   * reveal only shows it), so a reload replays the same roll.
   */
  rollNeighborhood(): RollResult<PersistedState>
  /** The Home step: settles the player in the rolled neighborhood with `home`. */
  moveIntoNeighborhood(home: string): MoveInResult<PersistedState>
  /** The player closed the offer ("Not now"); the HUD still opens the creator. */
  dismissOffer(): void
  /** The player skipped a step. */
  skipStep(step: string): void
  /** The player finished the creator. */
  complete(): void
}

/** The creator's actions on `store` (the game's store by default). */
export function creatorActions(store: GameStore = gameStore): CreatorActions {
  return {
    chooseLook: (look) => {
      const result = chooseLook(store.getState(), look, engineConfig)
      if (result.ok) store.setState({ player: result.snapshot.player })
      return result
    },
    surpriseLook: () => randomLook(randomSeed(), engineConfig),
    chooseTraits: (traitIds) => {
      const result = chooseTraits(store.getState(), traitIds, engineConfig)
      if (result.ok && result.changed) store.setState({ player: result.snapshot.player })
      return result
    },
    chooseCareer: (careerPath) => {
      const state = store.getState()
      const result = chooseCareer(state, careerPath, engineConfig)
      if (result.ok && result.changed) {
        const { save } = syncGoals({ ...state, player: result.snapshot.player }, engineConfig)
        store.setState({
          player: result.snapshot.player,
          goals: save.goals,
          ...levelUpPatch(result.levelUp, save.goals),
        })
      }
      return result
    },
    rollNeighborhood: () => {
      const save = persistedOf(store.getState())
      const result = commitRoll(save, 'neighborhood', createRng(randomSeed()), engineConfig)
      if (result.ok && !result.replayed) store.setState({ rolls: result.save.rolls })
      return result
    },
    moveIntoNeighborhood: (home) => {
      const result = moveIntoNeighborhood(persistedOf(store.getState()), home, engineConfig)
      if (result.ok) store.setState({ player: result.save.player })
      return result
    },
    dismissOffer: () => {
      const { creator, clock } = store.getState()
      store.setState({ creator: dismissCreatorOffer(creator, clock.minute) })
    },
    skipStep: (step) => {
      store.setState({ creator: skipCreatorStep(store.getState().creator, step, engineConfig) })
    },
    complete: () => {
      const { creator, clock } = store.getState()
      store.setState({ creator: completeCreator(creator, clock.minute) })
    },
  }
}
