'use client'

/**
 * Test-mode hook for the e2e suite (S16): the apartment's slots on screen, renderer counters,
 * the tier and its budgets on `window.__cloutcityTest.apartment`. Only builds with
 * NEXT_PUBLIC_TEST_HOOKS=1 (inlined at build time); in every other build the effect body is dead
 * code and is removed, so the hook never ships (scripts/shell-guard.ts checks `.next`).
 */
import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, PCFShadowMap, type BufferGeometry } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { ApartmentObjects } from './buildApartment'
import { avatarReserve, tierBudget } from './data'
import { ROOM_AVATAR_NAME, type ApartmentPlacement } from './types'

export interface ApartmentSlotState {
  /** A grid cell (src/engine/homeGrid.ts): `f{c}-{r}` or `w-{wall}-{i}`. */
  readonly id: string
  readonly kind: string
  /** The decor item whose slot (back-left cell, or wall cell) this is, or null. */
  readonly itemId: string | null
  /** The tap point in client (viewport) CSS pixels; null when behind the camera or off the canvas. */
  readonly screen: { readonly x: number; readonly y: number } | null
}

export interface ApartmentTestHook {
  /** True once a frame has drawn the room. */
  readonly ready: boolean
  home(): string
  tier(): QualityTier
  /** Switches the room to another quality tier (budget checks). */
  setTier(tier: QualityTier): void
  /** Frames rendered so far. */
  frames(): number
  /** Frames requested but not yet rendered (0 = idle). */
  pendingFrames(): number
  /**
   * Draw calls and triangles of the last rendered frame's main pass, whether the renderer draws a
   * shadow map and of which type, and the shadow pass's draw calls and triangles. three counts
   * only the main pass (it resets `info` after rendering the shadow map), so the shadow pass is
   * counted here from the casters: one draw per material group of every visible caster.
   */
  renderInfo(): {
    calls: number
    triangles: number
    shadowMap: boolean
    pcf: boolean
    shadowCalls: number
    shadowTriangles: number
  }
  /** The current tier's caps (perf.json `apartment`) and the reserve kept for S16a's avatar. */
  budget(): {
    drawCallsMax: number
    trianglesMax: number
    avatarReserve: { drawCalls: number; triangles: number }
  }
  slots(): ApartmentSlotState[]
  /** One cell's tap point in client CSS pixels, or null. */
  slotScreen(slotId: string): { x: number; y: number } | null
  /** Decor item ids the room draws now. */
  drawnItems(): string[]
  /** Buy mode's grid cells shown now, cell id → state (empty while the grid is hidden). */
  gridCells(): Readonly<Record<string, string>>
  /**
   * The player's avatar in the room (S16a): whether its model is drawn, its meshes (the head and
   * body, then any `-attachment`) and its triangles; null when no avatar group is in the room.
   */
  avatar(): {
    drawn: boolean
    meshes: string[]
    triangles: number
    /** S40c: where the Sim stands (room metres), the clip it plays, its prop and bubble key. */
    position: [number, number, number]
    clip: string | null
    prop: string | null
    bubble: string | null
  } | null
}

declare global {
  interface CloutcityTestHooks {
    apartment?: ApartmentTestHook
  }
}

export function ApartmentTestHook({
  home,
  tier,
  placed,
  setTier,
  objectsRef,
  readyRef,
}: {
  readonly home: string
  readonly tier: QualityTier
  readonly placed: Readonly<Record<string, ApartmentPlacement>>
  readonly setTier: (tier: QualityTier) => void
  readonly objectsRef: RefObject<ApartmentObjects | null>
  readonly readyRef: RefObject<boolean>
}) {
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    const slots = (): ApartmentSlotState[] => {
      const objects = objectsRef.current
      if (objects === null) return []
      const rect = gl.domElement.getBoundingClientRect()
      const bySlot = new Map(Object.values(placed).map((entry) => [entry.slotId, entry.itemId]))
      return objects.slots.map((slot) => {
        const point = objects.cellScreen(get().camera, slot.id, rect.width, rect.height)
        const visible =
          point !== null &&
          point.x >= 0 &&
          point.y >= 0 &&
          point.x <= rect.width &&
          point.y <= rect.height
        return {
          id: slot.id,
          kind: slot.kind,
          itemId: bySlot.get(slot.id) ?? null,
          screen: visible ? { x: point.x + rect.left, y: point.y + rect.top } : null,
        }
      })
    }
    const shadowPass = () => {
      let shadowCalls = 0
      let shadowTriangles = 0
      if (gl.shadowMap.enabled) {
        get().scene.traverseVisible((object) => {
          if (!(object instanceof Mesh) || !object.castShadow) return
          const geometry = object.geometry as BufferGeometry
          shadowCalls += Math.max(1, geometry.groups.length)
          shadowTriangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
        })
      }
      return { shadowCalls, shadowTriangles }
    }
    const hook: ApartmentTestHook = {
      get ready() {
        return readyRef.current
      },
      home: () => home,
      tier: () => tier,
      setTier,
      frames: () => gl.info.render.frame,
      pendingFrames: () => get().internal.frames,
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        shadowMap: gl.shadowMap.enabled,
        pcf: gl.shadowMap.type === PCFShadowMap,
        ...shadowPass(),
      }),
      budget: () => {
        const { drawCallsMax, trianglesMax } = tierBudget(tier)
        return { drawCallsMax, trianglesMax, avatarReserve: { ...avatarReserve } }
      },
      slots,
      slotScreen: (slotId) => slots().find((slot) => slot.id === slotId)?.screen ?? null,
      drawnItems: () => objectsRef.current?.drawnItems() ?? [],
      gridCells: () => objectsRef.current?.gridCells() ?? {},
      avatar: () => {
        const group = get().scene.getObjectByName(ROOM_AVATAR_NAME)
        if (group === undefined) return null
        const meshes: string[] = []
        let triangles = 0
        group.traverseVisible((object) => {
          if (!(object instanceof Mesh)) return
          meshes.push(object.name)
          const geometry = object.geometry as BufferGeometry
          triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
        })
        const sim = group.userData.sim as
          { clip: string; prop: string | null; bubble: string | null } | undefined
        return {
          drawn: meshes.length > 0,
          meshes,
          triangles,
          position: [group.position.x, group.position.y, group.position.z],
          clip: sim?.clip ?? null,
          prop: sim?.prop ?? null,
          bubble: sim?.bubble ?? null,
        }
      },
    }
    window.__cloutcityTest = { ...window.__cloutcityTest, apartment: hook }
    return () => {
      delete window.__cloutcityTest?.apartment
    }
  }, [gl, get, home, tier, placed, setTier, objectsRef, readyRef])

  return null
}
