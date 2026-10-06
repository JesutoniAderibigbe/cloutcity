/**
 * Clout levels: the minimal read S11 needs to gate jobs. The level thresholds live in
 * data/config/balance.json `clout.levels`; how clout is earned arrives with S13.
 */
import type { EngineConfig } from './config'

export interface CloutLevel {
  /** A `clout.levels` id, e.g. `nobody`. */
  readonly id: string
  /** 0-based position in `clout.levels` (0 is the lowest level). */
  readonly index: number
  readonly minClout: number
}

/** The highest level whose `minClout` the player holds (the lowest level for 0 clout). */
export function cloutLevel(clout: number, config: EngineConfig): CloutLevel {
  const { levels } = config.clout
  let index = 0
  levels.forEach((level, i) => {
    if (clout >= level.minClout) index = i
  })
  const level = levels[index]
  if (level === undefined) throw new Error('clout.levels is empty')
  return { id: level.id, index, minClout: level.minClout }
}

/** The level with id `levelId`, or undefined when config has no such level. */
export function findCloutLevel(levelId: string, config: EngineConfig): CloutLevel | undefined {
  const index = config.clout.levels.findIndex((level) => level.id === levelId)
  const level = config.clout.levels[index]
  return level === undefined ? undefined : { id: level.id, index, minClout: level.minClout }
}
