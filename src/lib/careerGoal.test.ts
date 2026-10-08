import { describe, expect, it } from 'vitest'
import { CAREER_PATHS } from '@/lib/data/avatarIds'
import { careerGoalLine } from './creatorCopy'
import { copy } from './copy'
import { goalLineKey } from './careerGoal'

describe('goal line (S16a)', () => {
  it("is the Dream's goal from the career copy, the same line the creator shows", () => {
    for (const path of CAREER_PATHS) expect(copy(goalLineKey(path))).toBe(careerGoalLine(path))
  })

  it('is the plain goal before a Dream is chosen', () => {
    expect(goalLineKey(null)).toBe('hud.goalLine')
  })
})
