/**
 * The room orbit's maths (S40b, RoomOrbit.tsx): the zoom and tilt limits around the fitted home
 * view, the eased way back to it, and the double tap that asks for it. Pure, no three or DOM.
 */
import type { ApartmentConfig } from './data'

type OrbitConfig = ApartmentConfig['orbit']

const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2

/**
 * How close and how far the camera may stand from the room's centre: shares of the fitted
 * distance, but never inside `outsideShare` of the room's bounding radius, so the camera stays
 * clear of every wall and the floor at any angle.
 */
export function zoomRange(
  fitDistance: number,
  radius: number,
  orbit: Pick<OrbitConfig, 'zoomInShare' | 'zoomOutShare' | 'outsideShare'>,
): { readonly min: number; readonly max: number } {
  const min = Math.max(radius * orbit.outsideShare, fitDistance * orbit.zoomInShare)
  return { min, max: Math.max(min, fitDistance * orbit.zoomOutShare) }
}

/** The tilt range (radians from straight down), widened to take in the home's own angle. */
export function polarRange(
  homePolar: number,
  orbit: Pick<OrbitConfig, 'minPolarDeg' | 'maxPolarDeg'>,
): { readonly min: number; readonly max: number } {
  return {
    min: Math.min(orbit.minPolarDeg * DEG, homePolar),
    max: Math.max(orbit.maxPolarDeg * DEG, homePolar),
  }
}

/** A camera pose around the room's centre: azimuth and polar angle (radians) and distance. */
export interface OrbitPose {
  readonly theta: number
  readonly phi: number
  readonly radius: number
}

/** `angle` less `from`, wrapped to (−π, π]: the short way round. */
function shortest(from: number, angle: number): number {
  const d = (((angle - from) % TWO_PI) + TWO_PI) % TWO_PI
  return d > Math.PI ? d - TWO_PI : d
}

/**
 * One frame of the way back to `home`: `ease` of what is left, the short way round, landing
 * exactly on it once within `epsilon` (or at once when `ease` is 1, as under reduced motion).
 */
export function easeToward(
  pose: OrbitPose,
  home: OrbitPose,
  ease: number,
  epsilon = 1e-3,
): { readonly pose: OrbitPose; readonly done: boolean } {
  const dTheta = shortest(pose.theta, home.theta)
  const dPhi = home.phi - pose.phi
  const dRadius = home.radius - pose.radius
  const left = Math.max(Math.abs(dTheta), Math.abs(dPhi), Math.abs(dRadius) / home.radius)
  if (ease >= 1 || left * (1 - ease) < epsilon) return { pose: home, done: true }
  return {
    pose: {
      theta: pose.theta + dTheta * ease,
      phi: pose.phi + dPhi * ease,
      radius: pose.radius + dRadius * ease,
    },
    done: false,
  }
}

/** One tap: where (client CSS pixels) and when (ms). */
export interface TapMark {
  readonly x: number
  readonly y: number
  readonly at: number
}

/** Whether `tap` is the second tap of a double tap after `previous`. */
export function isDoubleTap(
  previous: TapMark | null,
  tap: TapMark,
  orbit: Pick<OrbitConfig, 'doubleTapMs' | 'doubleTapSlopPx'>,
): boolean {
  return (
    previous !== null &&
    tap.at - previous.at <= orbit.doubleTapMs &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= orbit.doubleTapSlopPx
  )
}
