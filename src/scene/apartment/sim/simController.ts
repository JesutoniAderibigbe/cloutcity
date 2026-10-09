/**
 * The room Sim's behaviour (S40c), as a pure, time-stepped state machine with no three import:
 * given what the player asked for (a home action, a tap on the floor, a tap on a seat), it plans
 * the walk there around the furniture, the move into the pose (sitting down, lying back), the
 * hold, and getting up again, and each frame says where the body is, which clip it plays at
 * what speed, and which prop and bubble show.
 *
 * Visual only: the engine has already applied the action (its clock and stat effects) before
 * the Sim starts walking, and nothing here feeds back into the game.
 *
 * - Walking follows src/scene/apartment/sim/simWorld.ts `findPath`, speeding up and slowing down
 *   at `walk.accelMps2`, turning at most `walk.turnRadPerS`, and slowing to turn sharp corners.
 *   The walk clip's speed follows the body's (its stride in metres per loop is known), so the
 *   feet never slide.
 * - Poses pivot about the body's contact point (the hips on a seat, the back on a mattress):
 *   the Sim turns, lowers itself and, for lying, tips back about the hips rather than falling
 *   like a plank.
 * - Anything new (another action, a tap) cancels what runs: a Sim in a pose gets up first.
 * - Under reduced motion every walk and pose change is a cut; holds still last their time.
 */
import type { SimData, SimPose, SimStep, Vec3 } from './simData'
import {
  cellOf,
  findPath,
  insideRoom,
  isFree,
  placeAnchor,
  placeSpot,
  reachableNear,
  type P2,
  type PlacedAnchor,
  type SimWorld,
} from './simWorld'

/** The avatar's root (its feet), its heading about the vertical and its tilt back. */
export interface Body {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
  readonly tilt: number
}

export interface PropFrame {
  readonly id: string
  readonly at: Vec3
  readonly yaw: number
}

export interface SimFrame {
  readonly body: Body
  readonly clip: string
  readonly timeScale: number
  readonly prop: PropFrame | null
  /** The bubble's copy key, or null. */
  readonly bubble: string | null
  /** Whether the Sim needs frames now (moving, or a clip playing or fading). */
  readonly active: boolean
}

interface Walk {
  readonly kind: 'walk'
  readonly points: readonly P2[]
  next: number
}

interface Tween {
  readonly kind: 'tween'
  readonly from: Body
  readonly to: Body
  /** The pose's contact point in metres: the pivot the body turns about. */
  readonly contact: Vec3
  readonly clip: string
  readonly duration: number
  elapsed: number
}

interface Hold {
  readonly kind: 'hold'
  readonly clip: string
  readonly prop: PropFrame | null
  readonly bubble: string | null
  /** Milliseconds left; Infinity sits until the next request. */
  remainingMs: number
}

type Segment = Walk | Tween | Hold
type Thunk = () => Segment | null

interface Seat {
  readonly anchor: PlacedAnchor
  readonly pose: SimPose
  /** Where and how the Sim stands once it gets up. */
  readonly stand: Body
}

const STAND = 'stand'
const WALK_CLIP = 'walk'
const ARRIVED_M = 0.03
const MIN_WALK_M = 0.05
/** Speed kept while slowing for the end of a route, so the walk always arrives. */
const CREEP_MPS = 0.12

export function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** `v` turned by `tilt` about x, then by `yaw` about y (three's YXZ order: Ry · Rx). */
export function rotate(v: Vec3, yaw: number, tilt: number): Vec3 {
  const cosT = Math.cos(tilt)
  const sinT = Math.sin(tilt)
  const y = v[1] * cosT - v[2] * sinT
  const z1 = v[1] * sinT + v[2] * cosT
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  return [v[0] * cosY + z1 * sinY, y, -v[0] * sinY + z1 * cosY]
}

const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]

function routeLength(points: readonly P2[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return length
}

export interface SimControllerOptions {
  readonly data: SimData
  /** Whose fallback spots apply (`data.spots`): a home id, or a venue interior's id (S43). */
  readonly home: string
  readonly world: SimWorld
  readonly start: Body
  /** The avatar's metres per rig unit (its height over the rig's). */
  readonly metresPerRigUnit: number
  /** The rig's walk clip length in seconds. */
  readonly walkClipS: number
  readonly reducedMotion: boolean
}

export class SimController {
  private readonly data: SimData
  private home: string
  private world: SimWorld
  private k: number
  private walkClipS: number
  private reduced: boolean
  private body: Body
  private speed = 0
  private seat: Seat | null = null
  private current: Segment | null = null
  private queue: Thunk[] = []
  private clip = 'idle'
  private settleS = 0

  constructor(options: SimControllerOptions) {
    this.data = options.data
    this.home = options.home
    this.world = options.world
    this.body = options.start
    this.k = options.metresPerRigUnit
    this.walkClipS = options.walkClipS
    this.reduced = options.reducedMotion
    this.clip = this.standClip()
  }

  setWorld(world: SimWorld, home: string): void {
    this.world = world
    this.home = home
  }

  /** The avatar's metres per rig unit (its look's height). */
  setScale(metresPerRigUnit: number): void {
    this.k = metresPerRigUnit
  }

  /** The rig's walk clip length, in seconds. */
  setWalkClip(seconds: number): void {
    this.walkClipS = seconds
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced
  }

  /** Moves the Sim to `body` at once, standing, dropping whatever it was doing. */
  reset(body: Body): void {
    this.queue = []
    this.current = null
    this.seat = null
    this.speed = 0
    this.body = body
  }

  /**
   * Acts out action `actionId` (a home action, balance.json `place.homeActions`, or a venue
   * action, data/interiors/venues/<id>.json), then gets up.
   */
  perform(actionId: string): void {
    this.interrupt()
    const steps = this.data.actions.get(actionId) ?? [this.data.fallback]
    for (const step of steps) this.queue.push(() => this.beginStep(step))
    this.queue.push(() => this.exit())
  }

  /**
   * Walks to a floor point (pulled inside the room; the nearest reachable free spot when furniture
   * covers or boxes it in) and stands there.
   */
  goTo(point: P2): void {
    this.interrupt()
    const wanted = insideRoom(this.world, point, this.data.walk.edgeM)
    this.queue.push(() => this.exit())
    this.queue.push(() =>
      this.walkTo(reachableNear(this.world, { x: this.body.x, z: this.body.z }, wanted)),
    )
  }

  /**
   * Sits on item `itemId` (a sofa, chair, stool or bed edge) until the next request; false when
   * it has no seat the Sim can reach.
   */
  sitOn(itemId: string): boolean {
    const item = this.world.items.find((candidate) => candidate.id === itemId)
    if (item?.model == null) return false
    const anchors = (this.data.anchors.get(item.model) ?? [])
      .filter((anchor) => anchor.pose === 'sit')
      .map((anchor) => placeAnchor(item, anchor))
    const origin = this.seat?.stand ?? this.body
    const best = this.bestOf(anchors, { x: origin.x, z: origin.z })
    if (best === null) return false
    const pose = this.data.poses.get(best.anchor.pose)
    if (pose === undefined) return false
    this.interrupt()
    this.queue.push(() => this.exit())
    this.queue.push(() => this.walkTo(best.approach))
    this.queue.push(() => this.enter(best.anchor, pose, best.approach))
    this.queue.push(() => ({
      kind: 'hold',
      clip: pose.clip,
      prop: null,
      bubble: null,
      remainingMs: Infinity,
    }))
    return true
  }

  /** The item whose cells hold floor point `p`, or null. */
  itemAt(p: P2): string | null {
    const cell = cellOf(this.world, p)
    if (cell === null) return null
    for (const item of this.world.items) {
      if (item.cells.some(([c, r]) => c === cell[0] && r === cell[1]) && item.model !== null) {
        if (this.data.walkable.has(item.model)) continue
        return item.id
      }
    }
    return null
  }

  /** Whether the Sim stands idle where furniture now is (just placed over it in buy mode). */
  idleOnFurniture(): boolean {
    if (this.current !== null || this.queue.length > 0 || this.seat !== null) return false
    const cell = cellOf(this.world, { x: this.body.x, z: this.body.z })
    return cell !== null && !isFree(this.world, cell[0], cell[1])
  }

  /** Whether a timed, still pose is running (reduced motion): when to look again, in ms. */
  wakeInMs(): number | null {
    const segment = this.current
    if (segment?.kind !== 'hold' || !Number.isFinite(segment.remainingMs)) return null
    return Math.max(0, segment.remainingMs)
  }

  /** Advances `dt` seconds and returns the frame to draw. */
  update(dt: number): SimFrame {
    this.pump()
    let left = Math.max(0, dt)
    // A few segments may finish inside one step (a cut under reduced motion).
    for (let guard = 0; guard < 8 && this.current !== null; guard++) {
      const used = this.advance(this.current, left)
      if (this.current !== null && used >= left) break
      left = Math.max(0, left - used)
      this.pump()
      if (left === 0 && !this.reduced) break
    }
    const segment = this.current
    const clip =
      segment === null
        ? (this.seat?.pose.clip ?? this.standClip())
        : segment.kind === 'walk'
          ? WALK_CLIP
          : segment.clip
    if (clip !== this.clip) {
      this.clip = clip
      this.settleS = this.reduced ? 0 : this.data.fadeS
    } else {
      this.settleS = Math.max(0, this.settleS - dt)
    }
    const natural = (this.data.walk.strideRigUnits * this.k) / Math.max(this.walkClipS, 1e-3)
    const timeScale =
      segment?.kind === 'walk'
        ? Math.max(this.data.walk.minTimeScale, this.speed / Math.max(natural, 1e-3))
        : 1
    const moving =
      segment !== null && !(segment.kind === 'hold' && !Number.isFinite(segment.remainingMs))
    return {
      body: this.body,
      clip,
      timeScale,
      prop: segment?.kind === 'hold' ? segment.prop : null,
      bubble: segment?.kind === 'hold' ? segment.bubble : null,
      active: !this.reduced && (moving || this.settleS > 0),
    }
  }

  private standClip(): string {
    return this.data.poses.get(STAND)?.clip ?? 'idle'
  }

  private pump(): void {
    while (this.current === null && this.queue.length > 0) {
      const next = this.queue.shift()
      if (next !== undefined) this.current = next()
    }
  }

  /**
   * Stops what runs, so the caller's plan (which starts by getting up) follows at once. A walk
   * stops where the body is, keeping its speed; a Sim already getting up finishes doing so.
   */
  private interrupt(): void {
    const segment = this.current
    this.queue = []
    if (segment?.kind === 'tween' && this.seat === null) return
    if (segment?.kind !== 'walk') this.speed = 0
    this.current = null
  }

  /** Returns the seconds of `dt` the segment used (all of it unless it finished). */
  private advance(segment: Segment, dt: number): number {
    switch (segment.kind) {
      case 'walk':
        return this.advanceWalk(segment, dt)
      case 'tween': {
        const left = segment.duration - segment.elapsed
        segment.elapsed = Math.min(segment.duration, segment.elapsed + dt)
        this.body = this.tweenBody(segment)
        if (segment.elapsed >= segment.duration) {
          this.current = null
          return Math.max(0, left)
        }
        return dt
      }
      case 'hold': {
        const left = segment.remainingMs / 1000
        segment.remainingMs -= dt * 1000
        if (segment.remainingMs <= 0) {
          this.current = null
          return Math.max(0, left)
        }
        return dt
      }
    }
  }

  private advanceWalk(walk: Walk, dt: number): number {
    const { accelMps2, speedMps, turnRadPerS } = this.data.walk
    if (this.reduced) {
      const last = walk.points[walk.points.length - 1]
      const before = walk.points[walk.points.length - 2] ?? { x: this.body.x, z: this.body.z }
      if (last !== undefined) {
        const yaw = Math.atan2(last.x - before.x, last.z - before.z)
        this.body = { x: last.x, y: 0, z: last.z, yaw, tilt: 0 }
      }
      this.current = null
      return 0
    }
    let used = 0
    let left = dt
    while (left > 0) {
      const target = walk.points[walk.next]
      if (target === undefined) {
        this.current = null
        this.speed = 0
        return used
      }
      const dx = target.x - this.body.x
      const dz = target.z - this.body.z
      const distance = Math.hypot(dx, dz)
      if (distance < ARRIVED_M) {
        walk.next++
        continue
      }
      const remaining = distance + routeLength(walk.points.slice(walk.next))
      this.speed = Math.min(speedMps, this.speed + accelMps2 * left)
      this.speed = Math.min(this.speed, Math.max(CREEP_MPS, Math.sqrt(2 * accelMps2 * remaining)))
      const want = Math.atan2(dx, dz)
      const turn = wrapAngle(want - this.body.yaw)
      const maxTurn = turnRadPerS * left
      const yaw = wrapAngle(this.body.yaw + Math.max(-maxTurn, Math.min(maxTurn, turn)))
      // Facing away from the way on, slow right down and turn first.
      const facing = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2)))
      const step = this.speed * facing * left
      if (step >= distance) {
        const spent = distance / Math.max(this.speed * facing, 1e-3)
        this.body = { x: target.x, y: 0, z: target.z, yaw, tilt: 0 }
        walk.next++
        used += spent
        left -= spent
        continue
      }
      this.body = {
        x: this.body.x + (dx / distance) * step,
        y: 0,
        z: this.body.z + (dz / distance) * step,
        yaw,
        tilt: 0,
      }
      used += left
      left = 0
    }
    return used
  }

  private tweenBody(tween: Tween): Body {
    const t = tween.duration <= 0 ? 1 : tween.elapsed / tween.duration
    const yawT = smooth(Math.min(1, t * 1.6))
    const moveT = smooth(t)
    const { from, to, contact } = tween
    const yaw = wrapAngle(from.yaw + wrapAngle(to.yaw - from.yaw) * yawT)
    const tilt = from.tilt + (to.tilt - from.tilt) * moveT
    // The contact point travels; the body turns about it.
    const pivot = (body: Body) => {
      const offset = rotate(contact, body.yaw, body.tilt)
      return [body.x + offset[0], body.y + offset[1], body.z + offset[2]] as const
    }
    const a = pivot(from)
    const b = pivot(to)
    const offset = rotate(contact, yaw, tilt)
    return {
      x: a[0] + (b[0] - a[0]) * moveT - offset[0],
      y: a[1] + (b[1] - a[1]) * moveT - offset[1],
      z: a[2] + (b[2] - a[2]) * moveT - offset[2],
      yaw,
      tilt,
    }
  }

  /** Gets up from the pose the Sim is in, if any. */
  private exit(): Segment | null {
    const seat = this.seat
    if (seat === null) return null
    this.seat = null
    return {
      kind: 'tween',
      from: this.body,
      to: seat.stand,
      contact: scaled(seat.pose.contact, this.k),
      clip: this.standClip(),
      duration: this.reduced ? 0 : this.data.exitS,
      elapsed: 0,
    }
  }

  private walkTo(target: P2): Segment | null {
    const from = { x: this.body.x, z: this.body.z }
    if (Math.hypot(target.x - from.x, target.z - from.z) < MIN_WALK_M) return null
    const route = findPath(this.world, from, target, this.data.walk.clearanceM) ?? [from, target]
    return { kind: 'walk', points: route.slice(1), next: 0 }
  }

  /** Takes `pose` at `anchor`, from standing at `approach`. */
  private enter(anchor: PlacedAnchor, pose: SimPose, approach: P2): Segment {
    const contact = scaled(pose.contact, this.k)
    const offset = rotate(contact, anchor.headingRad, pose.tiltRad)
    const to: Body = {
      x: anchor.at[0] - offset[0],
      y: anchor.at[1] - offset[1],
      z: anchor.at[2] - offset[2],
      yaw: anchor.headingRad,
      tilt: pose.tiltRad,
    }
    // Lying down, the Sim gets up facing the side it came from; otherwise the way it sat.
    const away = Math.atan2(approach.x - anchor.at[0], approach.z - anchor.at[2])
    const standYaw =
      pose.tiltRad !== 0 &&
      Math.hypot(approach.x - anchor.at[0], approach.z - anchor.at[2]) > MIN_WALK_M
        ? away
        : anchor.headingRad
    this.seat = {
      anchor,
      pose,
      stand: { x: approach.x, y: 0, z: approach.z, yaw: standYaw, tilt: 0 },
    }
    return {
      kind: 'tween',
      from: this.body,
      to,
      contact,
      clip: pose.clip,
      duration: this.reduced ? 0 : this.data.enterS,
      elapsed: 0,
    }
  }

  /** The reachable anchor with the shortest walk from `origin`, and the approach point used. */
  private bestOf(
    anchors: readonly PlacedAnchor[],
    origin: P2,
  ): { anchor: PlacedAnchor; approach: P2 } | null {
    let best: { anchor: PlacedAnchor; approach: P2; length: number } | null = null
    for (const anchor of anchors) {
      for (const approach of anchor.approach) {
        const cell = cellOf(this.world, approach)
        if (cell === null || !isFree(this.world, cell[0], cell[1])) continue
        const route = findPath(this.world, origin, approach, this.data.walk.clearanceM)
        if (route === null) continue
        const length = routeLength(route)
        if (best === null || length < best.length) best = { anchor, approach, length }
      }
    }
    return best
  }

  /** Where a step happens: the best furniture, else the home's spot, else where the Sim stands. */
  private resolve(
    step: SimStep,
    origin: P2,
  ): { anchor: PlacedAnchor; approach: P2; poseId: string } | 'skip' | null {
    for (const poseId of step.poses) {
      for (const model of step.models) {
        const anchors = (this.data.anchors.get(model) ?? []).filter((a) => a.pose === poseId)
        if (anchors.length === 0) continue
        const placed = this.world.items
          .filter((item) => item.model === model)
          .flatMap((item) => anchors.map((anchor) => placeAnchor(item, anchor)))
        const best = this.bestOf(placed, origin)
        if (best !== null) return { ...best, poseId }
      }
    }
    for (const poseId of step.poses) {
      const spot = (this.data.spots[this.home] ?? []).find((candidate) => candidate.pose === poseId)
      const placed = spot === undefined ? null : placeSpot(this.world, spot)
      if (placed !== null) {
        const best = this.bestOf([placed], origin)
        if (best !== null) return { ...best, poseId }
      }
    }
    return step.optional ? 'skip' : null
  }

  /** Plans one step: get up, walk over, take the pose, hold it. */
  private beginStep(step: SimStep): Segment | null {
    const origin = this.seat?.stand ?? this.body
    const found = this.resolve(step, { x: origin.x, z: origin.z })
    if (found === 'skip') return null
    const thunks: Thunk[] = [() => this.exit()]
    let clip: string
    let poseId: string
    if (found === null) {
      // Nowhere fits: the Sim does it standing where it is, with the step's standing clip.
      const standing = step.poses
        .map((id) => ({ id, pose: this.data.poses.get(id) }))
        .find(({ pose }) => pose !== undefined && pose.tiltRad === 0 && pose.contact[1] === 0)
      poseId = standing?.id ?? STAND
      clip = standing?.pose?.clip ?? this.standClip()
    } else {
      const pose = this.data.poses.get(found.poseId)
      if (pose === undefined) return null
      poseId = found.poseId
      clip = pose.clip
      thunks.push(() => this.walkTo(found.approach))
      thunks.push(() => this.enter(found.anchor, pose, found.approach))
    }
    const anchor = found === null ? null : found.anchor
    thunks.push(() => ({
      kind: 'hold',
      clip,
      prop: this.propFor(step, anchor, poseId),
      bubble: step.bubble,
      remainingMs: step.holdMs,
    }))
    this.queue.unshift(...thunks)
    return null
  }

  private propFor(step: SimStep, anchor: PlacedAnchor | null, poseId: string): PropFrame | null {
    if (step.prop === null) return null
    if (step.propAt === 'anchor' && anchor?.prop != null) {
      return { id: step.prop, at: anchor.prop, yaw: anchor.headingRad }
    }
    const hands = this.data.hands.get(poseId) ?? this.data.hands.get(STAND)
    if (hands === undefined) return null
    const offset = rotate(scaled(hands, this.k), this.body.yaw, this.body.tilt)
    return {
      id: step.prop,
      at: [this.body.x + offset[0], this.body.y + offset[1], this.body.z + offset[2]],
      yaw: this.body.yaw,
    }
  }
}
