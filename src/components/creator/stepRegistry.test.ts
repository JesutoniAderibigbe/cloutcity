import { describe, expect, it } from 'vitest'
import { creatorConfig } from '@/engine/creatorConfig'
import { creatorSteps } from '@/engine/creatorFlow'
import { STEP_COMPONENTS } from './stepRegistry'

describe('creator step registry (S16a, D18)', () => {
  it('has a component for every enabled step, in creator.json order', () => {
    expect(creatorSteps(creatorConfig)).toEqual(['look', 'traits', 'dream', 'neighborhood', 'home'])
    for (const step of creatorSteps(creatorConfig))
      expect(STEP_COMPONENTS[step], step).toBeDefined()
  })

  it('leaves the disabled origin seam out until S44 adds its step', () => {
    expect(creatorSteps(creatorConfig)).not.toContain('origin')
    expect(STEP_COMPONENTS.origin).toBeUndefined()
  })
})
