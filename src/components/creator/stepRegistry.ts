'use client'

/**
 * The creator's step registry (S16a, D18): each step id in data/config/creator.json maps to its
 * component. A disabled step (S44's `origin` seam) has no entry and the flow leaves it out (engine
 * `creatorSteps`); S44 adds `OriginStep` here and flips the flag. The steps load with the
 * creator's own chunk: split per step, each would carry its own copy of the game store's
 * dependencies (PERF-3), which costs more than the steps themselves.
 */
import type { ComponentType } from 'react'
import type { CreatorStepId } from '@/engine/creator'
import DreamStep from './steps/DreamStep'
import HomeStep from './steps/HomeStep'
import LookStep from './steps/LookStep'
import NeighborhoodStep from './steps/NeighborhoodStep'
import TraitsStep from './steps/TraitsStep'
import type { StepProps } from './stepTypes'

export const STEP_COMPONENTS: Readonly<Partial<Record<CreatorStepId, ComponentType<StepProps>>>> = {
  look: LookStep,
  traits: TraitsStep,
  dream: DreamStep,
  neighborhood: NeighborhoodStep,
  home: HomeStep,
}
