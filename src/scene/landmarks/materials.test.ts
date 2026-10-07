import { BackSide, MeshBasicMaterial, MeshToonMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PALETTE } from './kit.fixture'
import { createLandmarkMaterials } from './materials'
import { DataTexture, NearestFilter, RedFormat } from 'three'

/** Stand-in for S04a's createToonRamp: a one-row red texture. */
function ramp() {
  const texture = new DataTexture(new Uint8Array([89, 166, 255]), 3, 1, RedFormat)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  return texture
}

describe('createLandmarkMaterials', () => {
  it('makes exactly three shared materials plus a dimmed variant', () => {
    const gradient = ramp()
    const materials = createLandmarkMaterials(gradient, PALETTE)
    expect(Object.keys(materials).sort()).toEqual([
      'body',
      'dimmed',
      'dispose',
      'outline',
      'windows',
    ])

    expect(materials.body).toBeInstanceOf(MeshToonMaterial)
    expect(materials.body.vertexColors).toBe(true)
    expect(materials.body.gradientMap).toBe(gradient)

    expect(materials.windows).toBeInstanceOf(MeshBasicMaterial)
    expect(materials.windows.vertexColors).toBe(true)

    expect(materials.outline).toBeInstanceOf(MeshBasicMaterial)
    expect(materials.outline.side).toBe(BackSide)
    expect(`#${materials.outline.color.getHexString()}`).toBe(PALETTE.outline)

    expect(materials.dimmed).toBeInstanceOf(MeshToonMaterial)
    expect(materials.dimmed.gradientMap).toBe(gradient)
    expect(materials.dimmed.vertexColors).toBe(false)
    expect(`#${materials.dimmed.color.getHexString()}`).toBe(PALETTE.dimmed)
  })

  it('disposes its materials but not the shared ramp', () => {
    const gradient = ramp()
    const rampDispose = vi.spyOn(gradient, 'dispose')
    const materials = createLandmarkMaterials(gradient, PALETTE)
    const spies = [materials.body, materials.windows, materials.outline, materials.dimmed].map(
      (material) => vi.spyOn(material, 'dispose'),
    )
    materials.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce()
    expect(rampDispose).not.toHaveBeenCalled()
  })
})
