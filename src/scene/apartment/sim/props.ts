/**
 * The room Sim's props (S40c): a pan on the hob while it cooks, a plate in its hands while it
 * eats. Each is a handful of boxes and discs from data/config/roomSim.json merged into one mesh
 * with vertex colours, drawn with the room shell's own material settings (toon, vertex colours,
 * front faces), so they add one draw call while shown and no new shader program.
 */
import { CylinderGeometry, FrontSide, Mesh, MeshToonMaterial, type Texture } from 'three'
import { tokenHex } from '../data'
import { boxAt, mergeParts, paintedPart } from '../parts'
import type { PropPart } from './simData'

const DISC_SEGMENTS = 14

function partGeometry(part: PropPart) {
  const [w, h, d] = part.size
  if (part.shape === 'box') return paintedPart(boxAt(part.size, part.at), tokenHex(part.token))
  const disc = new CylinderGeometry(w / 2, w / 2, h, DISC_SEGMENTS)
  disc.scale(1, 1, d / w)
  disc.translate(part.at[0], part.at[1], part.at[2])
  return paintedPart(disc, tokenHex(part.token))
}

export interface SimProps {
  readonly meshes: ReadonlyMap<string, Mesh>
  dispose(): void
}

export function buildProps(
  props: ReadonlyMap<string, readonly PropPart[]>,
  gradientMap: Texture,
): SimProps {
  const material = new MeshToonMaterial({ vertexColors: true, gradientMap, side: FrontSide })
  const meshes = new Map<string, Mesh>()
  for (const [id, parts] of props) {
    const mesh = new Mesh(mergeParts(parts.map(partGeometry), `${id} prop`), material)
    mesh.name = `apartment-prop-${id}`
    mesh.visible = false
    mesh.raycast = () => {}
    meshes.set(id, mesh)
  }
  return {
    meshes,
    dispose() {
      for (const mesh of meshes.values()) mesh.geometry.dispose()
      material.dispose()
    },
  }
}
