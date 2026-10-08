import { describe, expect, it } from 'vitest'
import { Box3, Mesh, Raycaster, Vector3 } from 'three'
import { scene } from '@/lib/data/config'
import { PLAYER_AVATAR_NAME, avatarSize, buildAvatar, mapCharacterHeight } from './buildAvatar'
import { farFade } from '../ambient/townsfolk'
import plotsJson from '@data/config/plots.json'
import manifest from '@data/assets/manifest.json'

const { avatar, camera } = scene

function triangles(mesh: Mesh): number {
  const { index, attributes } = mesh.geometry
  return (index?.count ?? attributes.position?.count ?? 0) / 3
}

describe('avatarSize (S05)', () => {
  it('grows with camera distance and is clamped at both ends', () => {
    expect(avatarSize(camera.distanceM, avatar)).toBeCloseTo(
      camera.distanceM * avatar.heightPerDistance,
    )
    expect(avatarSize(0, avatar)).toBe(avatar.minHeightM)
    expect(avatarSize(1e9, avatar)).toBe(avatar.maxHeightM)
    expect(avatarSize(camera.minDistanceM, avatar)).toBeGreaterThanOrEqual(avatar.minHeightM)
    expect(avatarSize(camera.maxDistanceM, avatar)).toBeLessThanOrEqual(avatar.maxHeightM)
  })

  it('is never smaller up close than at a farther distance', () => {
    let last = 0
    for (let d = camera.minDistanceM; d <= camera.maxDistanceM; d *= 1.5) {
      const size = avatarSize(d, avatar)
      expect(size).toBeGreaterThanOrEqual(last)
      last = size
    }
  })
})

describe('buildAvatar (S05)', () => {
  const built = buildAvatar('#ffcc00', [0.35, 0.65, 1], avatar)
  const meshes = built.group.children.filter((child): child is Mesh => child instanceof Mesh)

  it('is two meshes (two draw calls) under 1k triangles', () => {
    expect(built.group.name).toBe(PLAYER_AVATAR_NAME)
    expect(meshes).toHaveLength(2)
    const total = meshes.reduce((sum, mesh) => sum + triangles(mesh), 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThan(1000)
  })

  it('stands with its feet on the group origin and is exactly its height tall', () => {
    built.setHeight(50)
    built.group.updateMatrixWorld(true)
    const body = meshes.find((mesh) => mesh.name.endsWith('-body'))
    if (body === undefined) throw new Error('no body mesh')
    const box = new Box3().setFromObject(body)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(50, 6)
  })

  it('lays the ring flat just above the ground, wider than the body', () => {
    built.setHeight(1)
    built.group.updateMatrixWorld(true)
    const ring = meshes.find((mesh) => mesh.name.endsWith('-ring'))
    if (ring === undefined) throw new Error('no ring mesh')
    const box = new Box3().setFromObject(ring)
    expect(box.max.y - box.min.y).toBeCloseTo(0, 6)
    expect(box.min.y).toBeCloseTo(avatar.ringLiftRatio, 6)
    expect(box.max.x).toBeCloseTo(avatar.ringOuterRatio, 2)
    expect(avatar.ringOuterRatio).toBeGreaterThan(avatar.radiusRatio)
  })

  it('is never hit by a raycast, so taps go to the map', () => {
    built.setHeight(50)
    built.group.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(0, 25, 100), new Vector3(0, 0, -1))
    expect(ray.intersectObject(built.group, true)).toEqual([])
  })

  it('disposes without throwing', () => {
    expect(() => buildAvatar('#ffcc00', [0.5, 1], avatar).dispose()).not.toThrow()
  })
})

describe('mapCharacterHeight (S04q: people never outgrow the houses)', () => {
  const styles = ['game', 'real'] as const

  it('never passes the style cap at any zoom, and never shrinks as the camera pulls back', () => {
    for (const style of styles) {
      const cap = scene.mapStyles[style].characterMaxM
      let last = 0
      for (let d = camera.minDistanceM; d <= camera.maxDistanceM; d *= 1.2) {
        const h = mapCharacterHeight(d, avatar, cap)
        expect(h).toBeLessThanOrEqual(cap)
        expect(h).toBeGreaterThanOrEqual(last)
        last = h
      }
    }
  })

  it('caps the game map people below the smallest plot building', () => {
    const bounds = new Map(
      (
        manifest as unknown as {
          models: { id: string; bounds?: { min: number[]; max: number[] } }[]
        }
      ).models
        .filter((model) => model.bounds !== undefined)
        .map((model) => [model.id, model.bounds as { min: number[]; max: number[] }]),
    )
    const styles = Object.values(plotsJson.styles) as { model?: string; footprintM: number }[]
    const heights = styles.flatMap((style) => {
      const box = style.model === undefined ? undefined : bounds.get(style.model)
      if (box === undefined || style.footprintM === 0) return []
      const side = Math.max(
        (box.max[0] ?? 0) - (box.min[0] ?? 0),
        (box.max[2] ?? 0) - (box.min[2] ?? 0),
      )
      return [
        ((box.max[1] ?? 0) - (box.min[1] ?? 0)) *
          (style.footprintM / side) *
          plotsJson.buildingHeightScale,
      ]
    })
    expect(heights.length).toBeGreaterThan(0)
    expect(scene.mapStyles.game.characterMaxM).toBeLessThan(Math.min(...heights))
  })

  it('shrinks the locals away over the far band instead of popping', () => {
    expect(farFade(1000, 3000, 0.25)).toBe(1)
    expect(farFade(2250, 3000, 0.25)).toBe(1)
    expect(farFade(2625, 3000, 0.25)).toBeCloseTo(0.5)
    expect(farFade(3000, 3000, 0.25)).toBe(0)
  })
})
