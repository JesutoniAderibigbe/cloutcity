/**
 * The S16b modular-avatar build on a synthetic pack: several skinned meshes merge into one
 * skinned primitive, slots follow materials and meshes, stripped materials go and protected ones
 * survive every tier whole, finger and pole joints fold into the wrist and foot with weights
 * summing to 1, joints and clips are renamed (the rest dropped), every tier meets its triangle
 * target, and a hair piece cut from a skinned mesh stays in the bind pose.
 */
import { Document, NodeIO, type Node } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { describe, expect, it } from 'vitest'
import type { Pack } from './fetch.ts'
import { buildModel, planJoints } from './pipeline.ts'
import { ModelSchema, SourceSchema, type JointMap, type Model } from './schema.ts'

const JOINTS: JointMap = {
  collapse: [
    { match: '^Index\\d\\.(L|R)$', into: 'Wrist.$1' },
    { match: '^PT\\.(L|R)$', into: 'Foot.$1' },
  ],
  rename: {
    Root: 'root',
    Body: 'body',
    Head: 'head',
    'Wrist.L': 'hand-left',
    'Foot.L': 'foot-left',
  },
}

/** A (2n × n)-triangle grid in the xz plane at `y`, every vertex weighted to `joints`. */
function grid(
  doc: Document,
  n: number,
  y: number,
  joints: readonly [number, number],
  weights: readonly [number, number],
) {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      // A gentle dome, so the simplifier has curvature to weigh.
      positions.push(
        i / n - 0.5,
        y + 0.05 * Math.sin((Math.PI * i) / n) * Math.sin((Math.PI * j) / n),
        j / n - 0.5,
      )
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
    }
  }
  const count = positions.length / 3
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const acc = (
    type: 'VEC3' | 'VEC4' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  return doc
    .createPrimitive()
    .setIndices(acc('SCALAR', Uint32Array.from(indices)))
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(positions)))
    .setAttribute(
      'NORMAL',
      acc(
        'VEC3',
        new Float32Array(count * 3).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)),
      ),
    )
    .setAttribute(
      'JOINTS_0',
      acc(
        'VEC4',
        Uint16Array.from({ length: count * 4 }, (_, k) => (k % 4 < 2 ? (joints[k % 4] ?? 0) : 0)),
      ),
    )
    .setAttribute(
      'WEIGHTS_0',
      acc(
        'VEC4',
        Float32Array.from({ length: count * 4 }, (_, k) => (k % 4 < 2 ? (weights[k % 4] ?? 0) : 0)),
      ),
    )
}

async function syntheticPack(): Promise<Pack> {
  const doc = new Document()
  doc.createBuffer()
  const node = (name: string, t: [number, number, number] = [0, 0, 0]) =>
    doc.createNode(name).setTranslation(t)
  const root = node('Root')
  const body = node('Body', [0, 1, 0])
  const head = node('Head', [0, 0.6, 0])
  const wrist = node('Wrist.L', [0.5, 0.4, 0])
  const index1 = node('Index1.L', [0.1, 0, 0])
  const index2 = node('Index2.L', [0.05, 0, 0])
  const foot = node('Foot.L', [0.1, 0.05, 0])
  const pole = node('PT.L', [0.1, 0.5, 0.4])
  root.addChild(body).addChild(foot).addChild(pole)
  body.addChild(head).addChild(wrist)
  wrist.addChild(index1)
  index1.addChild(index2)
  const joints: Node[] = [root, body, head, wrist, index1, index2, foot, pole]
  const armature = doc.createNode('CharacterArmature').addChild(root)
  const scene = doc.createScene('Scene').addChild(armature)
  doc.getRoot().setDefaultScene(scene)
  // Inverse bind matrices: each joint's world translation, inverted.
  const world = (n: Node): number[] => {
    const parent = joints.find((j) => j.listChildren().includes(n))
    const own = n.getTranslation()
    const up = parent === undefined ? [0, 0, 0] : world(parent)
    return [0, 1, 2].map((k) => (up[k] ?? 0) + (own[k] ?? 0))
  }
  const ibm = new Float32Array(joints.length * 16)
  joints.forEach((joint, k) => {
    const [x, y, z] = world(joint)
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(x ?? 0), -(y ?? 0), -(z ?? 0), 1], k * 16)
  })
  const skin = doc.createSkin('skin').setInverseBindMatrices(
    doc
      .createAccessor()
      .setType('MAT4')
      .setArray(ibm)
      .setBuffer(doc.getRoot().listBuffers()[0] ?? null),
  )
  for (const joint of joints) skin.addJoint(joint)
  const material = (name: string, rgb: [number, number, number]) =>
    doc.createMaterial(name).setBaseColorFactor([...rgb, 1])
  const skinMat = material('Skin', [0.6, 0.4, 0.25])
  const shirt = material('White', [0.45, 0.45, 0.45])
  const eye = material('Eye', [0.03, 0.02, 0.01])
  const hair = material('Hair', [0.07, 0.03, 0.01])
  const bodyMesh = doc
    .createMesh('Cube.001')
    .addPrimitive(grid(doc, 12, 1.2, [1, 4], [0.6, 0.4]).setMaterial(skinMat))
    .addPrimitive(grid(doc, 12, 1.0, [1, 5], [0.5, 0.5]).setMaterial(shirt))
  const legMesh = doc
    .createMesh('Cube.002')
    .addPrimitive(grid(doc, 8, 0.2, [6, 7], [0.7, 0.3]).setMaterial(shirt))
  const headMesh = doc
    .createMesh('Cube.003')
    .addPrimitive(grid(doc, 10, 1.6, [2, 0], [1, 0]).setMaterial(skinMat))
    .addPrimitive(grid(doc, 2, 1.65, [2, 0], [1, 0]).setMaterial(eye))
    .addPrimitive(grid(doc, 10, 1.75, [2, 0], [1, 0]).setMaterial(hair))
  for (const [name, mesh] of [
    ['Char_Body', bodyMesh],
    ['Char_Legs', legMesh],
    ['Char_Head', headMesh],
  ] as const) {
    armature.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin))
  }
  const anim = (name: string) => {
    const animation = doc.createAnimation(name)
    for (const target of [body, index1]) {
      const sampler = doc
        .createAnimationSampler()
        .setInput(
          doc
            .createAccessor()
            .setType('SCALAR')
            .setArray(new Float32Array([0, 1])),
        )
        .setOutput(
          doc
            .createAccessor()
            .setType('VEC4')
            .setArray(new Float32Array([0, 0, 0, 1, 0, 0.1, 0, 0.995])),
        )
      animation
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(target)
            .setTargetPath('rotation')
            .setSampler(sampler),
        )
    }
    return animation
  }
  anim('Idle')
  anim('Gun_Shoot')
  const bytes = await new NodeIO().writeBinary(doc)
  const source = SourceSchema.parse({
    id: 'test-pack',
    kind: 'cc0-pack',
    title: 'Test pack',
    version: '1',
    author: 'Someone',
    homepage: 'https://example.org/pack',
    licence: 'CC0-1.0',
    licenceEvidence: { entry: 'License.txt', mustContain: ['CC0'] },
    download: { kind: 'gdrive-files', files: [{ path: 'glTF/Char.glb', id: 'A'.repeat(24) }] },
    factorEncoding: 'linear',
    grade: { lightness: 1, chroma: 1 },
  })
  return { source, files: new Map([['glTF/Char.glb', bytes]]), lock: undefined }
}

const base = {
  source: 'test-pack',
  entries: [{ path: 'glTF/Char.glb' }],
  fit: { scale: 1 },
  pivot: 'source',
  swatches: [],
  emissive: [],
  clips: [],
  loadPhase: 'creator',
  instanced: false,
  nameKey: 'models.name.test',
}
const tiers = (low: number, mid: number, high: number) => ({
  low: { triangles: low },
  mid: { triangles: mid },
  high: { triangles: high },
})
const ctx = {
  palette: {},
  maxDeltaE: 10,
  grade: { lightness: 1, chroma: 1 },
  jointMaps: { modular: JOINTS },
}

async function read(bytes: Uint8Array) {
  await MeshoptDecoder.ready
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(bytes)
}

const model = (fields: Record<string, unknown>): Model => ModelSchema.parse({ ...base, ...fields })

describe('modular skinned parts (S16b)', () => {
  it('merges the meshes into one skinned primitive at or under each tier target', async () => {
    const pack = await syntheticPack()
    const outfit = model({
      id: 'outfit-test',
      kind: 'skinned',
      meshes: ['Char_Body', 'Char_Legs'],
      joints: 'modular',
      category: 'avatar-body',
      tiers: tiers(150, 300, 500),
      slots: [
        { name: 'skin', materials: ['Skin'] },
        { name: 'top', materials: ['White'], meshes: ['Char_Body'] },
        { name: 'bottom', materials: ['White'], meshes: ['Char_Legs'] },
      ],
    })
    const built = await buildModel(outfit, pack, ctx)
    for (const [tier, target] of [
      ['low', 150],
      ['mid', 300],
      ['high', 500],
    ] as const) {
      expect(built.tiers[tier].triangles).toBeLessThanOrEqual(target)
      expect(built.tiers[tier].triangles).toBeGreaterThan(target * 0.8)
      const doc = await read(built.tiers[tier].bytes)
      const meshes = doc.getRoot().listMeshes()
      expect(meshes).toHaveLength(1)
      expect(meshes[0]?.listPrimitives()).toHaveLength(1)
      const prim = meshes[0]?.listPrimitives()[0]
      // Indexed, no normals: the runtime flat-shades it.
      expect(prim?.getAttribute('NORMAL')).toBeNull()
      expect(prim?.getIndices()).not.toBeNull()
      const slots = new Set(Array.from(prim?.getAttribute('_SLOT')?.getArray() ?? []))
      expect([...slots].sort()).toEqual([1, 2, 3])
    }
  })

  it('folds fingers and poles away, renames the joints and keeps weights summing to 1', async () => {
    const pack = await syntheticPack()
    const built = await buildModel(
      model({
        id: 'outfit-test',
        kind: 'skinned',
        meshes: ['Char_Body', 'Char_Legs'],
        joints: 'modular',
        category: 'avatar-body',
        tiers: tiers(400, 400, 400),
        slots: [],
      }),
      pack,
      ctx,
    )
    const doc = await read(built.tiers.high.bytes)
    const [skin] = doc.getRoot().listSkins()
    expect(skin?.listJoints().map((joint) => joint.getName())).toEqual([
      'root',
      'body',
      'head',
      'hand-left',
      'foot-left',
    ])
    expect(
      doc
        .getRoot()
        .listNodes()
        .some((n) => /Index|PT/.test(n.getName())),
    ).toBe(false)
    const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]
    const weights = prim?.getAttribute('WEIGHTS_0')
    const joints = prim?.getAttribute('JOINTS_0')
    const w: number[] = []
    const j: number[] = []
    for (let i = 0; i < (weights?.getCount() ?? 0); i++) {
      weights?.getElement(i, w)
      joints?.getElement(i, j)
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
      expect(Math.max(...j)).toBeLessThan(5)
    }
    expect(built.frame?.joints['hand-left']).toEqual([0.5, 1.4, 0])
    expect(planJoints(JOINTS, ['Root', 'Wrist.L', 'Index1.L']).target).toEqual([0, 1, 1])
    expect(() => planJoints(JOINTS, ['Root', 'Neck'])).toThrow(/no new name for Neck/)
  })

  it('strips a head’s hair and keeps the protected eyes whole on every tier', async () => {
    const pack = await syntheticPack()
    const built = await buildModel(
      model({
        id: 'head-test',
        kind: 'skinned',
        meshes: ['Char_Head'],
        joints: 'modular',
        stripMaterials: ['Hair'],
        protectMaterials: ['Eye'],
        category: 'avatar-head',
        tiers: tiers(40, 80, 400),
        slots: [{ name: 'skin', materials: ['Skin'] }],
      }),
      pack,
      ctx,
    )
    expect(Object.keys(built.frame?.materials ?? {})).toEqual(['Eye', 'Skin'])
    for (const tier of ['low', 'mid', 'high'] as const) {
      const doc = await read(built.tiers[tier].bytes)
      const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]
      const slot = prim?.getAttribute('_SLOT')
      const index = prim?.getIndices()
      let eye = 0
      for (let t = 0; t < (index?.getCount() ?? 0); t += 3) {
        if (slot?.getScalar(index?.getScalar(t) ?? 0) === 0) eye++
      }
      expect(eye).toBe(8)
    }
    expect(built.tiers.low.triangles).toBeLessThanOrEqual(40)
  })

  it('cuts a hair piece from the skinned head in the bind pose', async () => {
    const pack = await syntheticPack()
    const built = await buildModel(
      model({
        id: 'hair-test',
        kind: 'static',
        fromSkinned: { mesh: 'Char_Head', materials: ['Hair'], joint: 'Head' },
        attach: 'head',
        category: 'avatar-hair',
        tiers: tiers(60, 120, 400),
        slots: [{ name: 'hair', materials: ['Hair'] }],
      }),
      pack,
      ctx,
    )
    expect(built.bounds?.min[1]).toBeCloseTo(1.75, 2)
    expect(built.bounds?.max[0]).toBeCloseTo(0.5, 2)
    expect(built.tiers.low.triangles).toBeLessThanOrEqual(60)
    expect(built.tiers.high.triangles).toBe(200)
    await expect(
      buildModel(
        model({
          id: 'hair-test',
          kind: 'static',
          fromSkinned: { mesh: 'Char_Body', materials: ['Skin'], joint: 'Head' },
          attach: 'head',
          category: 'avatar-hair',
          tiers: tiers(60, 120, 400),
          slots: [],
        }),
        pack,
        ctx,
      ),
    ).rejects.toThrow(/follows Body, not Head/)
  })

  it('renames the kept clips, drops the rest and their folded joints’ channels', async () => {
    const pack = await syntheticPack()
    const built = await buildModel(
      model({
        id: 'rig-test',
        kind: 'rig',
        joints: 'modular',
        category: 'avatar-rig',
        tiers: {
          low: { ratio: 1, error: 0 },
          mid: { ratio: 1, error: 0 },
          high: { ratio: 1, error: 0 },
        },
        slots: [],
        clips: [{ from: 'Idle', as: 'idle' }],
      }),
      pack,
      ctx,
    )
    const doc = await read(built.tiers.high.bytes)
    const animations = doc.getRoot().listAnimations()
    expect(animations.map((a) => a.getName())).toEqual(['idle'])
    expect(animations[0]?.listChannels().map((c) => c.getTargetNode()?.getName())).toEqual(['body'])
  })

  it('rejects material rules without meshes and triangle targets on legacy skinned parts', () => {
    expect(
      ModelSchema.safeParse({
        ...base,
        id: 'x',
        kind: 'skinned',
        mesh: 'head-mesh',
        stripMaterials: ['Hair'],
        category: 'avatar-head',
        tiers: tiers(1, 1, 1),
        slots: [],
      }).success,
    ).toBe(false)
  })
})
