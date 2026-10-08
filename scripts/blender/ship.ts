/**
 * Turns one Blender-built landmark level (an uncompressed GLB from build.py: a `-body` mesh and
 * an optional `-windows` mesh, flat normals, COLOR_0) into the runtime format every hand-made
 * model ships in (S04h): ONE mesh with ONE primitive and a placeholder material, so the runtime
 * draws it with the shared model material (src/scene/models/materials.ts) and no new shader
 * program; COLOR_0 as linear u8; the lamps' colour in `_EMISSIVE` (the S04f night-glow
 * contract; zero elsewhere); then the S04h finish (quantize, reorder, meshopt with the vertex
 * codec v0 that three r182's bundled decoder reads).
 */
import { Document, NodeIO, type Primitive } from '@gltf-transform/core'
import { finishTier, type BuiltTier } from '../assets/pipeline.ts'

const toU8 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)

interface Soup {
  positions: number[]
  normals: number[]
  colours: number[]
  emissive: number[]
  indices: number[]
}

function append(soup: Soup, prim: Primitive, glows: boolean, name: string): void {
  const position = prim.getAttribute('POSITION')
  const normal = prim.getAttribute('NORMAL')
  const colour = prim.getAttribute('COLOR_0')
  const indices = prim.getIndices()
  if (position === null || normal === null || colour === null || indices === null) {
    throw new Error(`${name}: needs POSITION, NORMAL, COLOR_0 and indices`)
  }
  const base = soup.positions.length / 3
  const p = [0, 0, 0]
  const n = [0, 0, 0]
  const c = [0, 0, 0, 0]
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, p)
    normal.getElement(i, n)
    // getElement denormalises, so this is the linear colour in 0..1.
    colour.getElement(i, c)
    soup.positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)
    soup.normals.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)
    const rgb = [toU8(c[0] ?? 0), toU8(c[1] ?? 0), toU8(c[2] ?? 0)]
    soup.colours.push(...rgb)
    soup.emissive.push(...(glows ? rgb : [0, 0, 0]))
  }
  const index = [0]
  for (let i = 0; i < indices.getCount(); i++) {
    indices.getElement(i, index)
    soup.indices.push(base + (index[0] ?? 0))
  }
}

/** The runtime GLB of one level, named `<id>-lod<level>`. */
export async function shipLevel(glb: Uint8Array, id: string, level: number): Promise<BuiltTier> {
  const source = await new NodeIO().readBinary(glb)
  const soup: Soup = { positions: [], normals: [], colours: [], emissive: [], indices: [] }
  for (const node of source.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (mesh === null) continue
    const name = node.getName()
    if (!name.startsWith(`${id}-lod${level}-`)) throw new Error(`unexpected node ${name}`)
    for (const prim of mesh.listPrimitives()) append(soup, prim, name.endsWith('-windows'), name)
  }
  if (soup.indices.length === 0) throw new Error(`${id} L${level}: no triangles`)

  const name = `${id}-lod${level}`
  const doc = new Document()
  const buffer = doc.createBuffer()
  const accessor = (
    type: 'VEC3' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    normalized = false,
  ) =>
    doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', Float32Array.from(soup.positions)))
    .setAttribute('NORMAL', accessor('VEC3', Float32Array.from(soup.normals)))
    .setAttribute('COLOR_0', accessor('VEC3', Uint8Array.from(soup.colours), true))
    .setIndices(accessor('SCALAR', Uint32Array.from(soup.indices)))
    .setMaterial(
      doc
        .createMaterial('model')
        .setBaseColorFactor([1, 1, 1, 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(1),
    )
  if (soup.emissive.some((v) => v > 0)) {
    prim.setAttribute('_EMISSIVE', accessor('VEC3', Uint8Array.from(soup.emissive), true))
  }
  doc
    .createScene(name)
    .addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)))
  return finishTier(doc, { id: name, kind: 'static' })
}
