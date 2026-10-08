/**
 * The model runtime against the committed GLBs (three r182 GLTFLoader + bundled
 * MeshoptDecoder, in Node): preparing static and skinned models, `_SLOT` recolour, avatar
 * assembly on one skeleton with the rig's clips, instancing matrices, and the avatar's
 * capsule fallback rule.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { modelManifest, modelRef } from '@/lib/data/models'
import { scene } from '@/lib/data/config'
import { items } from '@/lib/data/content'
import { apartmentModelIds, decorEntries } from '../apartment/decorModels'
import { nightGlowSource } from '../lighting/nightGlow'
import { createModelMaterial } from './materials'
import { wantsAvatarModel } from '../avatar/PlayerAvatar'
import { assembleAvatar, clipNamed } from './AvatarModel'
import { placementMatrix } from './ModelInstances'
import {
  disposeModel,
  gltfLoader,
  prepareGltf,
  type LoadedModel,
  type RigModel,
  type SkinnedPartModel,
  type StaticModel,
} from './prepare'
import { disposeRecolored, recolorGeometry, slotColorsKey } from './slots'

const ROOT = join(import.meta.dirname, '../../..')

async function load(id: string, tier: 'low' | 'mid' | 'high' = 'high'): Promise<LoadedModel> {
  const ref = modelRef(id)
  const bytes = readFileSync(join(ROOT, 'public', ref.files[tier]))
  const gltf = await gltfLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  return prepareGltf(gltf, ref)
}

const asStatic = (model: LoadedModel): StaticModel => {
  if (model.kind !== 'static') throw new Error('expected a static model')
  return model
}
const asSkinned = (model: LoadedModel): SkinnedPartModel => {
  if (model.kind !== 'skinned') throw new Error('expected a skinned part')
  return model
}
const asRig = (model: LoadedModel): RigModel => {
  if (model.kind !== 'rig') throw new Error('expected a rig')
  return model
}

describe('prepareGltf', () => {
  it('keeps a static model as one geometry with its node transform and manifest triangles', async () => {
    const taxi = asStatic(await load('taxi'))
    const entry = modelManifest.models.find((model) => model.id === 'taxi')
    expect(taxi.triangles).toBe(entry?.tiers.high.triangles)
    // The real-world scale lives on the node (quantized positions), not in the vertices.
    const scale = new Vector3()
    taxi.matrix.decompose(new Vector3(), new Quaternion(), scale)
    expect(scale.x).toBeGreaterThan(1)
    expect(taxi.geometry.getAttribute('_emissive')?.itemSize).toBe(3)
  })

  it('returns the rig as clips only', async () => {
    const rig = asRig(await load('avatar-rig-f'))
    expect(rig.clips.map((clip) => clip.name).sort()).toEqual(
      [...modelRef('avatar-rig-f').clips].sort(),
    )
  })

  it('refuses a static model that is not one mesh', async () => {
    const ref = modelRef('avatar-rig-f')
    const bytes = readFileSync(join(ROOT, 'public', ref.files.high))
    const gltf = await gltfLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
    expect(() => prepareGltf(gltf, { id: 'avatar-rig-f', kind: 'static' })).toThrow(
      /exactly one mesh/,
    )
  })
})

describe('recolorGeometry', () => {
  const geometry = () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    g.setAttribute(
      'color',
      new BufferAttribute(new Uint8Array([10, 10, 10, 20, 20, 20, 30, 30, 30]), 3, true),
    )
    g.setAttribute('_slot', new BufferAttribute(new Uint8Array([0, 1, 2]), 1))
    return g
  }

  it('recolours only the vertices of the named slots and shares everything else', () => {
    const original = geometry()
    const variant = recolorGeometry(original, ['top', 'bottom'], { bottom: '#ffffff' })
    const color = variant.getAttribute('color')
    expect(color).not.toBe(original.getAttribute('color'))
    expect(variant.getAttribute('position')).toBe(original.getAttribute('position'))
    expect([color.getX(0), color.getX(1)]).toEqual([10 / 255, 20 / 255])
    expect(color.getX(2)).toBeCloseTo(1, 2)
    // The source colours are untouched.
    expect(original.getAttribute('color').getX(2)).toBeCloseTo(30 / 255, 5)
  })

  it('converts sRGB hex into the linear working space of the baked colours', () => {
    const variant = recolorGeometry(geometry(), ['top'], { top: '#808080' })
    expect(variant.getAttribute('color').getX(1)).toBeCloseTo(new Color('#808080').r, 2)
  })

  it('returns the original when nothing is recoloured, and rejects unknown slots', () => {
    const original = geometry()
    expect(recolorGeometry(original, ['top'], undefined)).toBe(original)
    expect(recolorGeometry(original, ['top'], {})).toBe(original)
    expect(() => recolorGeometry(original, ['top'], { hat: '#000000' })).toThrow(/hat/)
  })

  it('disposes a variant without detaching the shared attributes from the original', () => {
    const original = geometry()
    const variant = recolorGeometry(original, ['top'], { top: '#000000' })
    const disposed: string[] = []
    variant.addEventListener('dispose', () => disposed.push(...Object.keys(variant.attributes)))
    disposeRecolored(original, variant)
    expect(disposed).toEqual(['color'])
    expect(Object.keys(original.attributes).sort()).toEqual(['_slot', 'color', 'position'])
  })

  it('keys a recolour independently of key order', () => {
    expect(slotColorsKey({ a: '#000000', b: '#ffffff' })).toBe(
      slotColorsKey({ b: '#ffffff', a: '#000000' }),
    )
    expect(slotColorsKey(undefined)).toBe('')
  })
})

const tris = (id: string) =>
  modelManifest.models.find((m) => m.id === id)?.tiers.high.triangles ?? NaN

describe('prepareGltf flat shading (S16b)', () => {
  it('unwelds a pack part shipped without normals and gives each face its normal', async () => {
    const head = asSkinned(await load('head-f'))
    let mesh: SkinnedMesh | undefined
    head.scene.traverse((object) => {
      if (object instanceof SkinnedMesh) mesh = object
    })
    const geometry = mesh?.geometry
    expect(geometry?.index).toBeNull()
    const normal = geometry?.getAttribute('normal')
    expect(normal?.count).toBe(geometry?.getAttribute('position').count ?? 0)
    // The three corners of a face share its normal.
    expect([normal?.getX(1), normal?.getY(1), normal?.getZ(1)]).toEqual([
      normal?.getX(0),
      normal?.getY(0),
      normal?.getZ(0),
    ])
    expect(head.triangles).toBe(tris('head-f'))
    disposeModel(head)
  })
})

describe('assembleAvatar (S16b: one merged SkinnedMesh)', () => {
  it('merges body, face and hair into one skinned mesh the rig clips drive, hair on the head', async () => {
    const [rig, body, head, hair] = await Promise.all([
      load('avatar-rig-m'),
      load('outfit-m-casual'),
      load('head-m'),
      load('hair-parted'),
    ])
    const parts = {
      rig: modelRef('avatar-rig-m'),
      body: modelRef('outfit-m-casual'),
      head: modelRef('head-m'),
    }
    const material = new MeshBasicMaterial()
    const avatar = assembleAvatar(
      asSkinned(body),
      asSkinned(head),
      parts,
      material,
      { head: { skin: '#47291a' } },
      [
        {
          part: { ref: modelRef('hair-parted'), joint: 'head', offset: [0, 0, 0] },
          model: asStatic(hair),
        },
      ],
    )
    const meshes: SkinnedMesh[] = []
    avatar.root.traverse((object) => {
      if (object instanceof SkinnedMesh) meshes.push(object)
    })
    // One draw call, one (skinned) program whatever the avatar wears.
    expect(meshes).toHaveLength(1)
    const [mesh] = meshes
    if (mesh === undefined) throw new Error('mesh missing')
    expect(mesh.material).toBe(material)
    expect(avatar.triangles).toBe(tris('outfit-m-casual') + tris('head-m') + tris('hair-parted'))

    // The hair's vertices are the last ones, weighted 1 on the head joint.
    const headJoint = mesh.skeleton.bones.findIndex((bone) => bone.name === 'head')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    const last = skinIndex.count - 1
    expect(skinIndex.getX(last)).toBe(headJoint)
    expect(skinWeight.getX(last)).toBe(1)
    // In the bind pose the hair sits over the face: its top is above the head joint.
    const position = mesh.geometry.getAttribute('position')
    expect(position.getY(last)).toBeGreaterThan(1.5)

    const torso = mesh.skeleton.bones.find((bone) => bone.name === 'torso')
    if (torso === undefined) throw new Error('torso missing')
    const action = avatar.mixer.clipAction(clipNamed(asRig(rig), 'walk'))
    action.play()
    avatar.mixer.update(0)
    const start = torso.quaternion.clone()
    avatar.mixer.update(0.2)
    expect(torso.quaternion.angleTo(start)).toBeGreaterThan(0)

    avatar.dispose()
    for (const model of [body, head, hair]) disposeModel(model)
  })

  it('throws on a clip the rig does not have', async () => {
    const rig = asRig(await load('avatar-rig-f'))
    expect(() => clipNamed(rig, 'moonwalk')).toThrow(/moonwalk/)
  })
})

describe('placementMatrix', () => {
  it('applies the placement after the model node transform', () => {
    const model = new Matrix4().makeScale(2, 2, 2)
    const out = placementMatrix(
      { position: [10, 0, 0], rotationY: Math.PI / 2, scale: 3 },
      model,
      new Matrix4(),
    )
    const point = new Vector3(1, 0, 0).applyMatrix4(out)
    expect(point.x).toBeCloseTo(10)
    expect(point.z).toBeCloseTo(-6)
  })
})

describe('wantsAvatarModel', () => {
  const player = scene.models.player
  it('keeps the capsule on capsule tiers and on low-memory devices', () => {
    // S16b: no capsule tier any more; the low tier draws the low-LOD model on 2 GB or more.
    expect(player.capsuleTiers).toEqual([])
    expect(wantsAvatarModel(player, 'low', 8)).toBe(true)
    expect(wantsAvatarModel(player, 'low', player.minDeviceMemoryGB)).toBe(true)
    expect(wantsAvatarModel(player, 'low', 1)).toBe(false)
    expect(wantsAvatarModel({ ...player, capsuleTiers: ['low'] }, 'low', 8)).toBe(false)
    expect(wantsAvatarModel(player, 'mid', player.minDeviceMemoryGB - 0.5)).toBe(false)
    expect(wantsAvatarModel(player, 'mid', player.minDeviceMemoryGB)).toBe(true)
    // Browsers that do not report memory (Safari, Firefox) get the model.
    expect(wantsAvatarModel(player, 'high', undefined)).toBe(true)
  })
})

describe('createModelMaterial night glow (S04f contract)', () => {
  it('patches the shared material from the `_emissive` attribute with a zero default', () => {
    const uniform = { value: 0 }
    const material = createModelMaterial({ config: scene.models, tier: 'mid', nightGlow: uniform })
    expect(nightGlowSource(material)).toBe('attribute')
    expect(
      (material as unknown as { defaultAttributeValues: unknown }).defaultAttributeValues,
    ).toEqual({
      _emissive: [0, 0, 0],
    })
    const plain = createModelMaterial({ config: scene.models, tier: 'mid' })
    expect(nightGlowSource(plain)).toBeUndefined()
  })

  it('keeps the day intensity at 0: the contract only scales the glow by uNightGlow', () => {
    expect(scene.models.emissive.dayIntensity).toBe(0)
    expect(scene.models.emissive.nightIntensity).toBeGreaterThan(0)
  })
})

describe('apartment decor models', () => {
  it('maps only real decor items to static furniture models with the named recolour slot', () => {
    const decorIds = new Set(items.filter((item) => item.category === 'decor').map((i) => i.id))
    const entries = decorEntries()
    expect(entries.size).toBe(Object.keys(scene.models.decor).length)
    const manifestModels = new Map(modelManifest.models.map((model) => [model.id, model]))
    for (const [itemId, entry] of entries) {
      expect(decorIds.has(itemId)).toBe(true)
      const model = manifestModels.get(entry.model)
      expect(model?.kind, itemId).toBe('static')
      expect(model?.category, itemId).toBe('furniture')
      // A model with one look (a lamp, a fridge) has no recolour slot.
      if (entry.slot !== null) expect(model?.slots, itemId).toContain(entry.slot)
    }
  })

  it('draws the homes’ built-in fixtures with static furniture models too', () => {
    const ids = apartmentModelIds()
    for (const id of ['fridge', 'stove']) expect(ids).toContain(id)
  })
})
