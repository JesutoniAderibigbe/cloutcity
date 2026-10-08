/**
 * The seam between the apartment's logic and its art (S16, DEC-24). Everything the room looks
 * like comes through `ApartmentVisuals`: the room shell for a home and tier, and one object per
 * placed decor item in its colour. The scene graph (buildApartment.ts), slots, markers, picking,
 * budgets and tests only ever see these interfaces, so the code-built placeholders here can be
 * swapped for CC0 glTF models from the S04h asset pipeline without touching any of them.
 *
 * Contract for an implementation:
 * - an object's origin is the centre of its footprint (or its wall point), +z faces into the room;
 *   a wall item hangs on the wall plane, a floor or surface item stands on y = 0 (the scene turns,
 *   scales and moves it to its cells, src/scene/apartment/buildApartment.ts);
 * - it never raycasts (picking is screen-space, src/scene/pins/pick.ts);
 * - `dispose` frees what that object alone owns; shared resources go with `visuals.dispose`;
 * - it stays within perf.json `apartment` with `avatarReserve` kept free (home-apartment.spec.ts).
 */
import {
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { createToonRamp } from '../toonRamp'
import { buildDecorModel, type DecorModel } from './buildDecor'
import { buildRoomGeometry, shownRanges, type ShellFinishes } from './buildRoom'
import type { ApartmentConfig, RoomInterior, RoomPalette, RoomWall } from './data'

export interface RoomVisual {
  readonly object: Object3D
  /** Leaves out the walls between the camera and the room (the turned cutaway, S40b). */
  setHiddenWalls(hidden: ReadonlySet<RoomWall>): void
  dispose(): void
}

export interface DecorVisual {
  readonly object: Object3D
  /** Half the footprint's width, for the mid tier's blob shadow under floor and surface items. */
  readonly footprintM: number
  /** Its own size across (x) and deep (z), so the scene can fit it to its cells. */
  readonly sizeM: { readonly w: number; readonly d: number }
  /** How far it reaches behind its origin (−z): a wall item stands out from the wall by this. */
  readonly backM: number
  /** Casts into the high tier's shadow map. */
  setCastShadow(on: boolean): void
  dispose(): void
}

export interface ApartmentVisuals {
  /** The room shell for a home's layout at a tier, with its wall and floor finishes. */
  buildRoom(layout: RoomInterior, tier: QualityTier, finishes: ShellFinishes): RoomVisual
  /** One placed decor item in a colour (hex), or null for an item with no visual yet. */
  buildDecor(itemId: string, color: string): DecorVisual | null
  /** A built-in piece drawn by a catalog model (the kitchen's fridge), or null until it loads. */
  buildFixture(modelId: string): DecorVisual | null
  /** Frees what the visuals share (textures, cached geometry, shared materials). */
  dispose(): void
}

const noRaycast: Object3D['raycast'] = () => {}

/**
 * The placeholder art: the code-built room (buildRoom.ts) and low-poly decor (buildDecor.ts), toon
 * shaded with the shared ramp. Kept until the S16 visuals pass replaces it with CC0 models.
 */
export function createPlaceholderVisuals(
  config: ApartmentConfig,
  palette: RoomPalette,
  toonRamp: readonly number[],
): ApartmentVisuals {
  const gradientMap = createToonRamp(toonRamp)
  const models = new Map<string, DecorModel>()
  const model = (itemId: string) => {
    let built = models.get(itemId)
    if (built === undefined) {
      built = buildDecorModel(itemId)
      models.set(itemId, built)
    }
    return built
  }
  const secondMaterials = new Map<string, MeshToonMaterial>()
  const secondMaterial = (role: NonNullable<DecorModel['second']>) => {
    let material = secondMaterials.get(role)
    if (material === undefined) {
      material = new MeshToonMaterial({ color: palette[role], gradientMap })
      secondMaterials.set(role, material)
    }
    return material
  }

  return {
    buildRoom(layout, _tier, finishes) {
      const geometry: BufferGeometry = buildRoomGeometry(layout, config, palette, finishes)
      const sections = geometry.groups.map(({ start, count }) => ({ start, count }))
      // Single-sided: from the front, a wall's outer face turns away and is culled (the cutaway).
      const material = new MeshToonMaterial({ vertexColors: true, gradientMap, side: FrontSide })
      // A material list, so the renderer draws the geometry's groups: the walls shown now.
      const mesh = new Mesh(geometry, [material])
      mesh.name = 'apartment-room'
      mesh.receiveShadow = true
      mesh.raycast = noRaycast
      return {
        object: mesh,
        setHiddenWalls(hidden) {
          geometry.clearGroups()
          for (const range of shownRanges(sections, hidden)) {
            geometry.addGroup(range.start, range.count, range.materialIndex)
          }
        },
        dispose() {
          geometry.dispose()
          material.dispose()
        },
      }
    },
    buildDecor(itemId, color) {
      const built = model(itemId)
      const main = built.glows
        ? new MeshBasicMaterial({ color })
        : new MeshToonMaterial({ color, gradientMap })
      const materials: Material[] =
        built.second === null ? [main] : [main, secondMaterial(built.second)]
      const mesh = new Mesh(built.geometry, materials)
      mesh.raycast = noRaycast
      return {
        object: mesh,
        footprintM: built.footprintM,
        sizeM: built.sizeM,
        backM: built.backM,
        setCastShadow(on) {
          mesh.castShadow = on
        },
        dispose() {
          main.dispose()
        },
      }
    },
    // The fixtures' models arrive with the decor models; the counters are part of the shell.
    buildFixture: () => null,
    dispose() {
      for (const built of models.values()) built.geometry.dispose()
      for (const material of secondMaterials.values()) material.dispose()
      gradientMap.dispose()
    },
  }
}
