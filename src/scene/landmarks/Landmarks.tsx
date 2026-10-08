'use client'

/**
 * The modelled landmarks on the map (S07a): bridges, buildings, stations and government halls
 * at their real coordinates and orientation (data/landmarks/frames.derived.json), each a drei
 * `Detailed` switching between its kit-built levels by camera distance and culled beyond the
 * tier's distance. Builds wait for the city's first frame and then run one landmark per slice,
 * nearest first, so the map is playable before any model exists (PERF-4).
 *
 * The tier sets the levels built (low skips L0), the switch and cull distances
 * (lodDistanceScale), and whether outlines show. Landmarks on "expanding soon" land draw in the
 * dimmed teaser material. Models are not pickable: their pins are (S04c, Q5). Name chips show
 * the server's copy only.
 *
 * Blender models (S07c, DEC-25): a landmark with `glb` loads its tier's levels (high L0-L2,
 * mid L1-L3, low L2-L3) through the model runtime after the kit has built, nearest first, and
 * replaces its kit model once they arrive (src/scene/models/landmarkLevels.ts). They draw with a
 * district material (the program the buildings compiled: no new shader program) at the same
 * LOD distances; the kit, drawn at the Blender model's game scale, is the fallback while they
 * load or if they fail. A landmark with no kit model draws nothing until its GLB arrives.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useThree } from '@react-three/fiber'
import { Detailed } from '@react-three/drei/core/Detailed'
import {
  BufferAttribute,
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type LOD,
  type Material,
  type Texture,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CitySceneConfig } from '@/lib/data/schemas/scene'
import { log } from '@/lib/log'
import { LAY_FLAT_X } from '../geo/coords'
import type { GeoLandmark, GeoPin } from '../geo/schema'
import { DayNightContext, isNightGlowExcluded, useNightGlow } from '../lighting/nightGlow'
import { createBuildingMaterial, createWindowMask } from '../buildings/materials'
import { litWindowUv } from '../props/mergeChunk'
import { useTierSettings } from '../quality/tierSettings'
import { createSlicer } from '../schedule'
import type { ScenePalette } from '../types'
import { buildLandmark, disposeLandmark, type BuiltLandmark } from './buildLandmark'
import type { GlbLevel } from '../models/landmarkLevels'
import { GLB_TIER_LEVELS, glbLitUv, landmarkLod, type LandmarkLod } from './lod'
import { createLandmarkMaterials } from './materials'
import {
  LANDMARK_CHIPS_NAME,
  buildNameChipGeometry,
  chipScale,
  writeChipPositions,
  createNameAtlas,
  type NameChip,
} from './nameChips'
import type { LandmarkSource } from './source'

/** One landmark as the e2e hook reads it (src/scene/testHooks.tsx). */
export interface LandmarkState {
  readonly id: string
  readonly source: LandmarkSource
  readonly style: GeoLandmark['style']
  /** Built level drawn now (0 finest), or null when culled or not built yet. */
  readonly level: number | null
  readonly built: boolean
  /** Triangles of each built level, finest first. */
  readonly triangles: readonly number[]
  readonly lod: LandmarkLod
  /** Where its anchor is on screen, in client CSS pixels (null when behind the camera). */
  readonly screen: { readonly x: number; readonly y: number } | null
  readonly outlineVisible: boolean
}

export interface LandmarksState {
  readonly tier: QualityTier
  /** Every landmark is built (or failed and was skipped). */
  readonly done: boolean
  readonly failed: readonly string[]
  /** Blender models (S07c): every one of this tier is loaded (or failed and kept its kit). */
  readonly glbDone: boolean
  readonly glbFailed: readonly string[]
  readonly chips: { readonly visible: boolean; readonly texts: readonly string[] }
  readonly landmarks: readonly LandmarkState[]
}

export interface LandmarksHandle {
  state(): LandmarksState | null
}

interface LandmarksProps {
  readonly landmarks: readonly GeoLandmark[]
  readonly palette: ScenePalette
  readonly config: CitySceneConfig
  readonly groundY: number
  /** The city's shared toon ramp. */
  readonly gradientMap: Texture
  /** The city has drawn its first frame: building may start. */
  readonly active: boolean
  /** Display name per landmark id, from the server's copy. */
  readonly names: Readonly<Record<string, string>>
  /** Pin lift per landmark id (places layer `liftM`): chips float at the same height. */
  readonly pinLifts: ReadonlyMap<string, number>
  /**
   * The game map's ring landmarks (S07d) by id: where each stands there and at what size, or
   * null on Real NYC, where every landmark stands at its real frame.
   */
  readonly game: ReadonlyMap<string, GameSpot> | null
  /** The city's water and park materials: a ring landmark's pond and island draw with them. */
  readonly groundMaterials: { readonly water: Material; readonly park: Material }
  readonly handleRef: RefObject<LandmarksHandle | null>
}

const noRaycast = () => {}
/** Chip size changes smaller than this are not redrawn (except reaching full or least size). */
const CHIP_SCALE_STEP = 0.05
const _anchor = new Vector3()

const isBridge = (entry: GeoLandmark) => entry.frame.base === 'water'

/** A ring landmark on the game map: its pin's `gx`/`gy` and `game` (src/lib/world/placesLayer.ts). */
export interface GameSpot extends NonNullable<GeoPin['game']> {
  readonly x: number
  readonly y: number
}

/** Where a landmark is drawn now, at what size, and where its chip floats. */
interface Placement {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly liftM: number
  readonly chipShiftM: number
}

/** The island under a pond's landmark, as a share of the pond's radius. */
const ISLAND_SHARE = 0.72
/** The pond and its island sit just over the land top, the island over the pond (metres). */
const POND_RISE_M = 0.4
const ISLAND_RISE_M = 0.8
const POND_SEGMENTS = 40

function pondGeometry(radius: number, y: number): CircleGeometry {
  const geometry = new CircleGeometry(radius, POND_SEGMENTS)
  geometry.rotateX(LAY_FLAT_X)
  geometry.translate(0, y, 0)
  geometry.deleteAttribute('uv')
  return geometry
}

export function Landmarks({
  landmarks,
  palette,
  config,
  groundY,
  gradientMap,
  active,
  names,
  pinLifts,
  game,
  groundMaterials,
  handleRef,
}: LandmarksProps) {
  const placeOf = useCallback(
    (entry: GeoLandmark): Placement => {
      const spot = game?.get(entry.id)
      return spot === undefined
        ? {
            x: entry.frame.anchor.x,
            y: entry.frame.anchor.y,
            scale: 1,
            liftM: pinLifts.get(entry.id) ?? 0,
            chipShiftM: entry.chipShiftM ?? 0,
          }
        : {
            x: spot.x,
            y: spot.y,
            scale: spot.scale,
            liftM: spot.liftM,
            chipShiftM: spot.chipShiftM ?? 0,
          }
    },
    [game, pinLifts],
  )
  const settings = useTierSettings()
  const tier = settings.tier
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const lods = useRef(new Map<string, LOD>())
  const [built, setBuilt] = useState<{ tier: QualityTier; models: BuiltLandmark[] } | null>(null)
  const [failed, setFailed] = useState<readonly string[]>([])
  const [chipsVisible, setChipsVisible] = useState(false)

  // Windows glow with the shared night-glow uniform (S04f contract); a landmark whose category
  // must never glow (a memorial) gets the same materials without it.
  const glow = useNightGlow()
  // Name chips are unlit: they share the rig's tint colour, so they dim with the night (S04f).
  const unlitTint = useContext(DayNightContext).unlitTint.value
  const needsPlain = landmarks.some((entry) => isNightGlowExcluded(entry.category))
  const materials = useMemo(
    () => createLandmarkMaterials(gradientMap, palette.landmarks, { uniform: glow }),
    [gradientMap, palette.landmarks, glow],
  )
  const plainMaterials = useMemo(
    () => (needsPlain ? createLandmarkMaterials(gradientMap, palette.landmarks) : null),
    [needsPlain, gradientMap, palette.landmarks],
  )
  useEffect(() => () => materials.dispose(), [materials])

  // Blender models, and the kit's bodies, draw on a district material, built exactly as
  // Buildings.tsx builds its own, so they share the program the buildings compiled (S07c: no new
  // shader program). Glowing Blender vertices sample a lit window of the same mask; every other
  // vertex (and the kit's bodies, which carry no uv) reads a wall texel.
  const windowsOn = config.buildings.windows[tier]
  const glbMaterial = useMemo(() => {
    const mask = windowsOn ? createWindowMask(config.buildings) : null
    const material = createBuildingMaterial({
      gradientMap,
      colors: 'vertex',
      ...(mask === null
        ? {}
        : {
            windows: {
              uniform: glow,
              mask,
              color: palette.buildings.window,
              mipBias: config.buildings.windowMipBias,
            },
          }),
    })
    const litUv = mask === null ? null : litWindowUv(mask, config.buildings.windowTileCells)
    return { material, mask, litUv }
  }, [windowsOn, config.buildings, gradientMap, glow, palette.buildings.window])
  useEffect(
    () => () => {
      glbMaterial.material.dispose()
      glbMaterial.mask?.dispose()
    },
    [glbMaterial],
  )
  useEffect(() => () => plainMaterials?.dispose(), [plainMaterials])

  // Built once the city is on screen, nearest first, one landmark per slice; rebuilt per tier.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const done: BuiltLandmark[] = []
    const failures: string[] = []
    const settingsFor = {
      landTopY: groundY,
      heightScale: config.landmarks.heightScale,
      outlineWidthM: config.landmarks.outlineWidthM,
      outline: config.landmarks.outline,
      windows: config.landmarks.windows,
    }
    camera.getWorldPosition(_anchor)
    const away = (entry: GeoLandmark) => {
      const at = placeOf(entry)
      return Math.hypot(at.x - _anchor.x, at.y + _anchor.z)
    }
    const order = [...landmarks].sort((a, b) => away(a) - away(b))
    const step = createSlicer(config.buildings.buildSliceMs)
    void (async () => {
      for (const entry of order) {
        await step()
        if (cancelled) break
        // The kit: the fallback while a Blender model loads, at that model's game scale.
        if (entry.model === undefined) continue
        try {
          done.push(
            buildLandmark(
              entry.model,
              entry.frame,
              tier,
              palette.landmarks,
              settingsFor,
              entry.glb?.gameScale,
            ),
          )
        } catch (error) {
          // A model that fails to build is left out; the rest of the map carries on.
          failures.push(entry.id)
          log.warn('Landmark model failed to build', {
            id: entry.id,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (cancelled) {
        for (const model of done) disposeLandmark(model)
        return
      }
      setFailed(failures)
      setBuilt({ tier, models: done })
      invalidate()
    })()
    return () => {
      cancelled = true
    }
    // The order is only a priority: a map style switch moves the models without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, landmarks, tier, groundY, config, palette.landmarks, camera, invalidate])

  // Frees the previous tier's geometry once it is replaced (or on unmount).
  useEffect(
    () => () => {
      for (const model of built?.models ?? []) disposeLandmark(model)
    },
    [built],
  )

  // Blender models, once the kit is up: nearest first, one landmark per slice, each swapped in
  // as soon as its levels arrive. A failed load keeps the kit (or nothing, without one).
  const kitDone = built !== null && built.tier === tier
  const [glbs, setGlbs] = useState<{
    readonly tier: QualityTier
    readonly byId: ReadonlyMap<string, readonly GlbLevel[]>
    readonly failed: readonly string[]
    readonly done: boolean
  } | null>(null)
  useEffect(() => {
    if (!active || !kitDone) return
    let cancelled = false
    const loaded = new Map<string, readonly GlbLevel[]>()
    const failures: string[] = []
    camera.getWorldPosition(_anchor)
    const away = (entry: GeoLandmark) => {
      const at = placeOf(entry)
      return Math.hypot(at.x - _anchor.x, at.y + _anchor.z)
    }
    const order = landmarks
      .filter((entry) => entry.glb !== undefined)
      .sort((a, b) => away(a) - away(b))
    const step = createSlicer(config.buildings.buildSliceMs)
    const dimColor = new Color(palette.landmarks.dimmed)
    const publish = (done: boolean) => {
      if (cancelled) return
      setGlbs({ tier, byId: new Map(loaded), failed: [...failures], done })
      invalidate()
    }
    void (async () => {
      const { loadLandmarkLevels } = await import('../models/landmarkLevels')
      await loadLandmarkLevels(
        order.map((entry) => ({
          id: entry.id,
          // A memorial never glows; a teaser is dimmed and dark (S04f contract).
          litUv: glbLitUv(entry, glbMaterial.litUv),
          dim:
            entry.style === 'teaser' ? { color: dimColor, mix: config.landmarks.teaserDim } : null,
        })),
        {
          levels: GLB_TIER_LEVELS[tier],
          tier,
          cacheMaxEntries: config.models.cacheMaxEntries,
          step,
        },
        {
          cancelled: () => cancelled,
          loaded: (id, levels) => {
            loaded.set(id, levels)
            publish(false)
          },
          failed: (id) => failures.push(id),
        },
      )
      publish(true)
    })()
    return () => {
      cancelled = true
      for (const levels of loaded.values()) for (const level of levels) level.geometry.dispose()
    }
    // The order is only a priority: a map style switch moves the models without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    kitDone,
    landmarks,
    tier,
    camera,
    invalidate,
    config.buildings.buildSliceMs,
    config.models.cacheMaxEntries,
    palette.landmarks.dimmed,
    config.landmarks.teaserDim,
    glbMaterial.litUv,
  ])
  const glbOf = useCallback(
    (id: string): readonly GlbLevel[] | undefined =>
      glbs !== null && glbs.tier === tier ? glbs.byId.get(id) : undefined,
    [glbs, tier],
  )

  // Name chips: one mesh, one atlas, built with the models.
  const chips = useMemo(() => {
    if (built === null) return null
    // Every landmark's chip, kit or Blender model, once the kit has built.
    const list: NameChip[] = landmarks.flatMap((entry) => {
      const text = names[entry.id]
      if (text === undefined) return []
      const at = placeOf(entry)
      return [
        {
          x: at.x,
          y: at.y - config.landmarkChips.offsetM + at.chipShiftM,
          height: groundY + at.liftM + config.landmarkChips.liftM,
          text,
        },
      ]
    })
    if (list.length === 0) return null
    const texture = createNameAtlas(
      list.map((chip) => chip.text),
      palette.chip.fill,
      palette.chip.ink,
      config.landmarkChips,
    )
    // Drawn over the buildings (UX-14): a chip sinking into Midtown's towers cannot be read. A
    // depth setting is GL state, not a shader define: no new program.
    const material = new MeshBasicMaterial({
      map: texture,
      alphaTest: config.landmarkChips.alphaTest,
      depthTest: false,
    })
    material.color = unlitTint
    const mesh = new Mesh(buildNameChipGeometry(list, config.landmarkChips), material)
    mesh.renderOrder = 1
    mesh.name = LANDMARK_CHIPS_NAME
    mesh.raycast = noRaycast
    return { mesh, texture, material, list, texts: list.map((chip) => chip.text) }
  }, [built, landmarks, names, placeOf, groundY, config.landmarkChips, palette.chip, unlitTint])
  useEffect(
    () => () => {
      chips?.mesh.geometry.dispose()
      chips?.material.dispose()
      chips?.texture.dispose()
    },
    [chips],
  )

  // Chips show near the camera target only, like the line letters, and shrink in a focus view
  // so one chip never covers the models around it (S07c). Resizing rewrites 4 vertices a chip,
  // only when the size moves by a step, so an orbit at one zoom rewrites nothing.
  useEffect(() => {
    if (!(controls instanceof MapControls)) return
    let drawnScale = 1
    const update = () => {
      const distance = controls.getDistance()
      setChipsVisible(distance <= config.landmarks.labelMaxDistanceM)
      if (chips === null) return
      const scale = chipScale(distance, config.landmarkChips)
      if (scale === drawnScale) return
      const end = scale === 1 || scale === config.landmarkChips.minScale
      if (!end && Math.abs(scale - drawnScale) < CHIP_SCALE_STEP) return
      drawnScale = scale
      const positions = chips.mesh.geometry.getAttribute('position')
      if (!(positions instanceof BufferAttribute)) return
      writeChipPositions(positions, chips.list, config.landmarkChips, scale)
      chips.mesh.geometry.computeBoundingSphere()
      invalidate()
    }
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [controls, config.landmarks.labelMaxDistanceM, config.landmarkChips, chips, invalidate])

  useEffect(() => {
    handleRef.current = {
      state: () => {
        const rect = gl.domElement.getBoundingClientRect()
        return {
          tier,
          done: built !== null && built.tier === tier,
          failed: [...failed],
          glbDone: glbs !== null && glbs.tier === tier && glbs.done,
          glbFailed: glbs !== null && glbs.tier === tier ? [...glbs.failed] : [],
          chips: { visible: chips !== null && chipsVisible, texts: chips?.texts ?? [] },
          landmarks: landmarks.map((entry): LandmarkState => {
            const model = built?.models.find((m) => m.id === entry.id)
            const glbLevels = glbOf(entry.id)
            const lod = lods.current.get(entry.id)
            const current = lod?.getCurrentLevel()
            const drawn = glbLevels ?? model?.levels
            const levels = drawn?.length ?? 0
            const source: LandmarkSource = glbLevels === undefined ? 'kit' : 'glb'
            const at = placeOf(entry)
            _anchor.set(at.x, groundY, -at.y).project(camera)
            const onScreen = _anchor.z >= -1 && _anchor.z <= 1
            return {
              id: entry.id,
              source,
              style: entry.style,
              level:
                drawn === undefined || current === undefined || current >= levels
                  ? null
                  : (drawn[current]?.level ?? null),
              built: drawn !== undefined,
              triangles:
                glbLevels === undefined
                  ? (model?.triangles ?? [])
                  : glbLevels.map((level) => level.triangles),
              lod: ((lod) => ({
                ...lod,
                distances: lod.distances.map((distance) => distance * at.scale),
              }))(landmarkLod(config.landmarks, tier, settings.lodDistanceScale, isBridge(entry))),
              screen: onScreen
                ? {
                    x: rect.left + ((_anchor.x + 1) / 2) * rect.width,
                    y: rect.top + ((1 - _anchor.y) / 2) * rect.height,
                  }
                : null,
              outlineVisible:
                source === 'kit' &&
                settings.outlines &&
                entry.style === 'normal' &&
                model?.levels[0]?.outline !== undefined,
            }
          }),
        }
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [
    handleRef,
    gl,
    camera,
    tier,
    built,
    glbs,
    glbOf,
    failed,
    chips,
    chipsVisible,
    landmarks,
    groundY,
    config.landmarks,
    settings,
    placeOf,
  ])

  // Ponds (S07d): a ring landmark set "on the water" stands on an island in a pond beside the
  // cluster, drawn with the city's own water and park materials.
  const ponds = useMemo(() => {
    if (game === null) return []
    return [...game.entries()].flatMap(([id, spot]) =>
      spot.pondM === undefined
        ? []
        : [
            {
              id,
              x: spot.x,
              y: spot.y,
              water: pondGeometry(spot.pondM, groundY + POND_RISE_M),
              island: pondGeometry(spot.pondM * ISLAND_SHARE, groundY + ISLAND_RISE_M),
            },
          ],
    )
  }, [game, groundY])
  useEffect(
    () => () => {
      for (const pond of ponds) {
        pond.water.dispose()
        pond.island.dispose()
      }
    },
    [ponds],
  )

  if (built === null) return null
  return (
    <group name="landmarks">
      {ponds.map((pond) => (
        <group
          key={`pond-${pond.id}`}
          name={`landmark-${pond.id}-pond`}
          position={[pond.x, 0, -pond.y]}
        >
          <mesh geometry={pond.water} material={groundMaterials.water} raycast={noRaycast} />
          <mesh
            geometry={pond.island}
            material={groundMaterials.park}
            receiveShadow
            raycast={noRaycast}
          />
        </group>
      ))}
      {landmarks.map((entry) => {
        const lod = landmarkLod(config.landmarks, tier, settings.lodDistanceScale, isBridge(entry))
        const glbLevels = glbOf(entry.id)
        // A ring landmark on the game map stands at its ring spot, scaled about the land top, so
        // its base stays on the ground.
        const at = placeOf(entry)
        // A model drawn at `scale` looks at distance d as the full model does at d / scale, so
        // its levels switch that much nearer; it still culls where a full-size one would.
        const switches = lod.distances.map((distance) => distance * at.scale)
        if (glbLevels !== undefined) {
          // A teaser draws dimmed and flat, like its kit. A memorial shares the district
          // material and its program, but loaded with no lit uv (glbLitUv): every vertex samples
          // a wall texel, so no window ever lights on it (S04f, src/scene/lighting/nightGlow.ts).
          const glbMaterialOf = entry.style === 'teaser' ? materials.dimmed : glbMaterial.material
          return (
            <Detailed
              key={entry.id}
              ref={(object: LOD | null) => {
                if (object === null) lods.current.delete(entry.id)
                else lods.current.set(entry.id, object)
              }}
              name={`landmark-${entry.id}`}
              position={[at.x, groundY * (1 - at.scale), -at.y]}
              rotation={[0, (-entry.frame.headingDeg * Math.PI) / 180, 0]}
              scale={at.scale}
              distances={[...switches.slice(0, glbLevels.length), lod.cullM]}
              hysteresis={config.landmarks.hysteresis}
            >
              {[
                ...glbLevels.map((level) => (
                  <mesh
                    key={level.level}
                    name={`landmark-${entry.id}-glb${level.level}`}
                    geometry={level.geometry}
                    material={glbMaterialOf}
                    raycast={noRaycast}
                  />
                )),
                <group key="culled" name={`landmark-${entry.id}-culled`} />,
              ]}
            </Detailed>
          )
        }
        const model = built.models.find((m) => m.id === entry.id)
        if (model === undefined) return null
        const teaser = entry.style === 'teaser'
        const set =
          isNightGlowExcluded(entry.category) && plainMaterials !== null
            ? plainMaterials
            : materials
        return (
          <Detailed
            key={model.id}
            ref={(object: LOD | null) => {
              if (object === null) lods.current.delete(model.id)
              else lods.current.set(model.id, object)
            }}
            name={`landmark-${model.id}`}
            position={[at.x, groundY * (1 - at.scale), -at.y]}
            scale={at.scale}
            distances={[...switches.slice(0, model.levels.length), lod.cullM]}
            hysteresis={config.landmarks.hysteresis}
          >
            {[
              ...model.levels.map((level) => (
                <group key={level.level} name={`landmark-${model.id}-l${level.level}`}>
                  <mesh
                    geometry={level.body}
                    material={
                      teaser ? set.dimmed : set === plainMaterials ? set.body : glbMaterial.material
                    }
                    raycast={noRaycast}
                  />
                  {level.windows !== undefined && !teaser ? (
                    <mesh geometry={level.windows} material={set.windows} raycast={noRaycast} />
                  ) : null}
                  {level.outline !== undefined && !teaser ? (
                    <mesh
                      geometry={level.outline}
                      material={set.outline}
                      visible={settings.outlines}
                      raycast={noRaycast}
                    />
                  ) : null}
                </group>
              )),
              // Beyond the cull distance the landmark draws nothing.
              <group key="culled" name={`landmark-${model.id}-culled`} />,
            ]}
          </Detailed>
        )
      })}
      {chips !== null ? <primitive object={chips.mesh} visible={chipsVisible} /> : null}
    </group>
  )
}
