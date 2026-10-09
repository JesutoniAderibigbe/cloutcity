'use client'

/**
 * Test-mode hook for the venue interiors (S43): renderer counters (draw calls, triangles,
 * programs), the tier and its caps, the crowd and the player's Sim on
 * `window.__cloutcityTest.venue`. Only builds with NEXT_PUBLIC_TEST_HOOKS=1 (inlined at build
 * time); in every other build the effect body is dead code and is removed.
 */
import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, type BufferGeometry } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CrowdMember } from '@/lib/world/venueCrowd'
import type { VenueObjects } from './buildVenue'
import { playerLookStore } from '@/state/playerLook'
import { setInteriorOccupants, type InteriorActivity } from '@/state/venueOccupants'
import { occupantReserve, venueBudget } from './data'
import { VENUE_AVATAR_NAME } from './types'

export interface VenueTestHook {
  /** True once a frame has drawn the interior. */
  readonly ready: boolean
  placeId(): string
  interior(): string
  open(): boolean
  tier(): QualityTier
  setTier(tier: QualityTier): void
  frames(): number
  /** The last frame's main pass: draw calls, triangles, and shader programs compiled so far. */
  renderInfo(): { calls: number; triangles: number; programs: number }
  budget(): {
    drawCallsMax: number
    trianglesMax: number
    occupantReserve: { drawCalls: number; triangles: number }
  }
  /** The locals planned inside (activity and pose), and how many the layer draws. */
  crowd(): { planned: { activity: string; pose: string }[]; drawn: number }
  /** The venue's own pieces' triangles. */
  piecesTriangles(): number
  /**
   * Puts `count` stand-in real players inside (the player's own look, as presence would hand
   * over other players'), with the given activities in turn; 0 clears them.
   */
  setOccupants(count: number, activities: readonly InteriorActivity[]): void
  /** The player's Sim: where it stands and what it plays; null before it loads. */
  avatar(): { drawn: boolean; position: [number, number, number]; clip: string | null } | null
}

declare global {
  interface CloutcityTestHooks {
    venue?: VenueTestHook
  }
}

export function VenueTestHook({
  placeId,
  interiorId,
  tier,
  open,
  crowd,
  setTier,
  piecesRef,
  readyRef,
}: {
  readonly placeId: string
  readonly interiorId: string
  readonly tier: QualityTier
  readonly open: boolean
  readonly crowd: readonly CrowdMember[]
  readonly setTier: (tier: QualityTier) => void
  readonly piecesRef: RefObject<VenueObjects | null>
  readonly readyRef: RefObject<boolean>
}) {
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    const hook: VenueTestHook = {
      get ready() {
        return readyRef.current
      },
      placeId: () => placeId,
      interior: () => interiorId,
      open: () => open,
      tier: () => tier,
      setTier,
      frames: () => gl.info.render.frame,
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? 0,
      }),
      budget: () => {
        const { drawCallsMax, trianglesMax } = venueBudget(tier)
        return { drawCallsMax, trianglesMax, occupantReserve: { ...occupantReserve } }
      },
      crowd: () => {
        let drawn = 0
        get().scene.traverse((object) => {
          if (object.name === 'venue-crowd') {
            for (const child of object.children) {
              if (child instanceof Mesh && child.visible && child.name.endsWith('-skin')) {
                drawn += (child as unknown as { count: number }).count
              }
            }
          }
        })
        return {
          planned: crowd.map((member) => ({ activity: member.activity, pose: member.pose })),
          drawn,
        }
      },
      piecesTriangles: () => piecesRef.current?.triangles() ?? 0,
      setOccupants: (count, activities) => {
        const look = playerLookStore.getState().look
        if (look === null) return
        setInteriorOccupants(
          placeId,
          Array.from({ length: count }, (_, i) => ({
            id: `test-${i}`,
            handle: `player${i + 1}`,
            avatar: look,
            activity: activities[i % Math.max(1, activities.length)] ?? 'idle',
          })),
        )
      },
      avatar: () => {
        const group = get().scene.getObjectByName(VENUE_AVATAR_NAME)
        if (group === undefined) return null
        let drawn = false
        group.traverseVisible((object) => {
          if (object instanceof Mesh && (object.geometry as BufferGeometry).index !== undefined) {
            drawn = true
          }
        })
        const sim = group.userData.sim as { clip: string } | undefined
        return {
          drawn,
          position: [group.position.x, group.position.y, group.position.z],
          clip: sim?.clip ?? null,
        }
      },
    }
    window.__cloutcityTest = { ...window.__cloutcityTest, venue: hook }
    return () => {
      delete window.__cloutcityTest?.venue
    }
  }, [gl, get, placeId, interiorId, open, tier, crowd, setTier, piecesRef, readyRef])

  return null
}
