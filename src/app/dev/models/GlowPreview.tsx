'use client'

/**
 * Showcase-only stand-in for the night glow, so review screenshots show lit windows and lamps
 * before the S04f night-glow contract (`patchNightGlow` on the shared material) reaches this
 * branch. It patches no shader and adds no uniform: each instanced model with `_emissive`
 * vertices gets an additive, unlit twin whose vertex colour is that glow colour, scaled by the
 * scene.json `models.emissive` intensity. Delete it once the runtime material carries the glow.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three'

const noRaycast: Object3D['raycast'] = () => {}

/** Removes a twin without freeing the buffers it shares with its source model. */
function dropTwin(twin: InstancedMesh): void {
  twin.removeFromParent()
  twin.geometry.setIndex(null)
  for (const name of Object.keys(twin.geometry.attributes)) twin.geometry.deleteAttribute(name)
  twin.geometry.dispose()
}

export function GlowPreview({ intensity }: { readonly intensity: number }) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const material = useRef<MeshBasicMaterial | null>(null)
  const twins = useRef(new Map<InstancedMesh, InstancedMesh>())

  useEffect(() => {
    const own = twins.current
    return () => {
      for (const twin of own.values()) dropTwin(twin)
      own.clear()
      material.current?.dispose()
    }
  }, [])

  useFrame(() => {
    if (intensity <= 0) return
    material.current ??= new MeshBasicMaterial({
      vertexColors: true,
      color: new Color(intensity, intensity, intensity),
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    let added = false
    for (const [source, twin] of twins.current) {
      if (source.parent !== null) continue
      dropTwin(twin)
      twins.current.delete(source)
    }
    scene.traverse((object) => {
      if (!(object instanceof InstancedMesh) || twins.current.has(object)) return
      const glow = object.geometry.getAttribute('_emissive')
      if (glow === undefined || object.parent === null || material.current === null) return
      const geometry = new BufferGeometry()
      geometry.setIndex(object.geometry.index)
      geometry.setAttribute('position', object.geometry.getAttribute('position'))
      geometry.setAttribute('color', glow)
      const twin = new InstancedMesh(geometry, material.current, object.count)
      twin.instanceMatrix = object.instanceMatrix
      twin.boundingSphere = object.boundingSphere
      twin.raycast = noRaycast
      twin.renderOrder = 1
      object.parent.add(twin)
      twins.current.set(object, twin)
      added = true
    })
    if (added) invalidate()
  })
  return null
}
