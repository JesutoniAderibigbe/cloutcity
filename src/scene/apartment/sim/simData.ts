/**
 * The room Sim's data (S40c) for its lazy chunk: data/config/roomSim.json (walking, poses,
 * props, each home action's steps) and data/homes/interactions.json (where each furniture model
 * is used, and each home's fallback spots). Both are validated against their zod schemas in
 * src/lib/data (roomSim-data.test.ts); this chunk reads the raw JSON and narrows it here,
 * throwing at load on anything unexpected (fail fast), so classic zod never ships with it.
 */
import interactionsJson from '@data/homes/interactions.json'
import roomSimJson from '@data/config/roomSim.json'
import type { HomeIdLiteral } from '@/lib/data/homes'

export type Vec3 = readonly [number, number, number]

export interface SimPose {
  readonly clip: string
  /** Where the body meets its seat or mattress, in rig units from the feet. */
  readonly contact: Vec3
  readonly tiltRad: number
}

export interface SimStep {
  readonly poses: readonly string[]
  readonly models: readonly string[]
  readonly holdMs: number
  readonly optional: boolean
  readonly prop: string | null
  readonly propAt: 'anchor' | 'hands'
  /** A copy key, or null. */
  readonly bubble: string | null
}

export interface SimAnchor {
  readonly pose: string
  /** Metres in the item's frame at turn 0. */
  readonly at: Vec3
  readonly headingRad: number
  readonly approach: readonly Vec3[]
  readonly prop: Vec3 | null
}

export interface SimSpot {
  readonly pose: string
  readonly slot: string
  readonly headingRad: number
  readonly heightM: number
}

export interface PropPart {
  readonly shape: 'box' | 'disc'
  readonly size: Vec3
  readonly at: Vec3
  readonly token: string
}

export interface SimData {
  readonly walk: {
    readonly speedMps: number
    readonly accelMps2: number
    readonly turnRadPerS: number
    readonly strideRigUnits: number
    readonly minTimeScale: number
    readonly clearanceM: number
    readonly edgeM: number
  }
  readonly fadeS: number
  readonly enterS: number
  readonly exitS: number
  readonly poses: ReadonlyMap<string, SimPose>
  readonly props: ReadonlyMap<string, readonly PropPart[]>
  readonly actions: ReadonlyMap<string, readonly SimStep[]>
  readonly fallback: SimStep
  readonly hands: ReadonlyMap<string, Vec3>
  readonly bubble: { readonly aboveHeadM: number; readonly joint: string }
  readonly walkable: ReadonlySet<string>
  readonly anchors: ReadonlyMap<string, readonly SimAnchor[]>
  readonly spots: Readonly<Record<HomeIdLiteral, readonly SimSpot[]>>
}

const DEG = Math.PI / 180

function fail(what: string): never {
  throw new Error(`room sim data: ${what}`)
}

function vec3(value: readonly number[], what: string): Vec3 {
  const [x, y, z] = value
  if (value.length !== 3 || x === undefined || y === undefined || z === undefined) fail(what)
  return [x, y, z]
}

interface RawStep {
  readonly poses: readonly string[]
  readonly models: readonly string[]
  readonly holdMs: number
  readonly optional?: boolean
  readonly prop?: string
  readonly propAt?: string
  readonly bubble?: string
}

function step(raw: RawStep, what: string): SimStep {
  const propAt = raw.propAt ?? 'anchor'
  if (propAt !== 'anchor' && propAt !== 'hands') fail(`${what}.propAt`)
  return {
    poses: raw.poses,
    models: raw.models,
    holdMs: raw.holdMs,
    optional: raw.optional ?? false,
    prop: raw.prop ?? null,
    propAt,
    bubble: raw.bubble ?? null,
  }
}

function load(): SimData {
  const raw = roomSimJson
  const poses = new Map(
    Object.entries(raw.poses).map(([id, pose]): [string, SimPose] => [
      id,
      {
        clip: pose.clip,
        contact: vec3(pose.contactRigUnits, `poses.${id}`),
        tiltRad: pose.tiltDeg * DEG,
      },
    ]),
  )
  const props = new Map(
    Object.entries(raw.props).map(([id, prop]): [string, PropPart[]] => [
      id,
      prop.parts.map((part, i) => {
        if (part.shape !== 'box' && part.shape !== 'disc') fail(`props.${id}[${i}].shape`)
        return {
          shape: part.shape,
          size: vec3(part.size, `props.${id}[${i}].size`),
          at: vec3(part.at, `props.${id}[${i}].at`),
          token: part.token,
        }
      }),
    ]),
  )
  const actions = new Map(
    Object.entries(raw.actions as Record<string, readonly RawStep[]>).map(
      ([id, steps]): [string, SimStep[]] => [
        id,
        steps.map((entry, i) => step(entry, `actions.${id}[${i}]`)),
      ],
    ),
  )
  for (const [id, steps] of actions) {
    for (const entry of steps) {
      for (const pose of entry.poses) if (!poses.has(pose)) fail(`actions.${id} pose ${pose}`)
      if (entry.prop !== null && !props.has(entry.prop)) fail(`actions.${id} prop ${entry.prop}`)
    }
  }
  const anchors = new Map(
    Object.entries(interactionsJson.models).map(([model, list]): [string, SimAnchor[]] => [
      model,
      list.map((anchor, i) => {
        if (!poses.has(anchor.pose)) fail(`interactions ${model}[${i}] pose`)
        const prop = 'prop' in anchor ? anchor.prop : undefined
        return {
          pose: anchor.pose,
          at: vec3(anchor.at, `interactions ${model}[${i}].at`),
          headingRad: anchor.headingDeg * DEG,
          approach: anchor.approach.map((p, j) => vec3(p, `interactions ${model}[${i}][${j}]`)),
          prop: prop === undefined ? null : vec3(prop, `interactions ${model}[${i}].prop`),
        }
      }),
    ]),
  )
  const spotsOf = (home: HomeIdLiteral): SimSpot[] =>
    interactionsJson.homes[home].spots.map((spot) => ({
      pose: poses.has(spot.pose) ? spot.pose : fail(`${home} spot pose`),
      slot: spot.slot,
      headingRad: spot.rotationDeg * DEG,
      heightM: spot.heightM,
    }))
  return {
    walk: {
      speedMps: raw.walk.speedMps,
      accelMps2: raw.walk.accelMps2,
      turnRadPerS: raw.walk.turnDegPerS * DEG,
      strideRigUnits: raw.walk.strideRigUnits,
      minTimeScale: raw.walk.minTimeScale,
      clearanceM: raw.walk.clearanceM,
      edgeM: raw.walk.edgeM,
    },
    fadeS: raw.fadeS,
    enterS: raw.enterS,
    exitS: raw.exitS,
    poses,
    props,
    actions,
    fallback: step({ ...raw.fallback, models: [] }, 'fallback'),
    hands: new Map(
      Object.entries(raw.hands).map(([pose, at]): [string, Vec3] => [
        pose,
        vec3(at, `hands.${pose}`),
      ]),
    ),
    bubble: raw.bubble,
    walkable: new Set(interactionsJson.walkable),
    anchors,
    spots: {
      'queens-room': spotsOf('queens-room'),
      'brooklyn-1br': spotsOf('brooklyn-1br'),
      'manhattan-loft': spotsOf('manhattan-loft'),
    },
  }
}

export const simData: SimData = load()
