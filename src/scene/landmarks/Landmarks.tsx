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
import { Color, Mesh, MeshBasicMaterial, Vector3, type LOD, type Texture } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CitySceneConfig } from '@/lib/data/schemas/scene'
import { log } from '@/lib/log'
import type { GeoLandmark } from '../geo/schema'
import { DayNightContext, isNightGlowExcluded, useNightGlow } from '../lighting/nightGlow'
import { createBuildingMaterial, createWindowMask } from '../buildings/materials'
import { litWindowUv } from '../props/mergeChunk'
import { useTierSettings } from '../quality/tierSettings'
import { createSlicer } from '../schedule'
import type { ScenePalette } from '../types'
import { buildLandmark, disposeLandmark, type BuiltLandmark } from './buildLandmark'
import type { GlbLevel } from '../models/landmarkLevels'
import { GLB_TIER_LEVELS, landmarkLod, type LandmarkLod } from './lod'
import { createLandmarkMaterials } from './materials'
import {
  LANDMARK_CHIPS_NAME,
  buildNameChipGeometry,
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
  readonly handleRef: RefObject<LandmarksHandle | null>
}

const noRaycast = () => {}
const _anchor = new Vector3()

const isBridge = (entry: GeoLandmark) => entry.frame.base === 'water'

export function Landmarks({
  landmarks,
  palette,
  config,
  groundY,
  gradientMap,
  active,
  names,
  pinLifts,
  handleRef,
}: LandmarksProps) {
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
    const order = [...landmarks].sort(
      (a, b) =>
        Math.hypot(a.frame.anchor.x - _anchor.x, a.frame.anchor.y + _anchor.z) -
        Math.hypot(b.frame.anchor.x - _anchor.x, b.frame.anchor.y + _anchor.z),
    )
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
    const order = landmarks
      .filter((entry) => entry.glb !== undefined)
      .sort(
        (a, b) =>
          Math.hypot(a.frame.anchor.x - _anchor.x, a.frame.anchor.y + _anchor.z) -
          Math.hypot(b.frame.anchor.x - _anchor.x, b.frame.anchor.y + _anchor.z),
      )
    const step = createSlicer(config.buildings.buildSliceMs)
    const dimColor = new Color(palette.landmarks.dimmed)
    const publish = (done: boolean) => {
      if (cancelled) return
      setGlbs({ tier, byId: new Map(loaded), failed: [...failures], done })
      invalidate()
    }
    void (async () => {
      const { loadGlbLevels } = await import('../models/landmarkLevels')
      for (const entry of order) {
        await step()
        if (cancelled) break
        const glb = entry.glb
        if (glb === undefined) continue
        const teaser = entry.style === 'teaser'
        try {
          const levels = await loadGlbLevels({
            id: entry.id,
            versions: glb.v,
            levels: GLB_TIER_LEVELS[tier],
            tier,
            cacheMaxEntries: config.models.cacheMaxEntries,
            // A memorial never glows; a teaser is dimmed and dark (S04f contract).
            litUv: teaser || isNightGlowExcluded(entry.category) ? null : glbMaterial.litUv,
            dim: teaser ? { color: dimColor, mix: config.landmarks.teaserDim } : null,
            step,
          })
          if (cancelled) {
            for (const level of levels) level.geometry.dispose()
            break
          }
          loaded.set(entry.id, levels)
          publish(false)
        } catch (error) {
          // Expected offline (model files are never precached): the kit stays.
          failures.push(entry.id)
          log.info('Landmark Blender model did not load; the kit stays', {
            id: entry.id,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      publish(true)
    })()
    return () => {
      cancelled = true
      for (const levels of loaded.values()) for (const level of levels) level.geometry.dispose()
    }
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
      return [
        {
          x: entry.frame.anchor.x,
          y: entry.frame.anchor.y - config.landmarkChips.offsetM + (entry.chipShiftM ?? 0),
          height: groundY + (pinLifts.get(entry.id) ?? 0) + config.landmarkChips.liftM,
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
    return { mesh, texture, material, texts: list.map((chip) => chip.text) }
  }, [built, landmarks, names, pinLifts, groundY, config.landmarkChips, palette.chip, unlitTint])
  useEffect(
    () => () => {
      chips?.mesh.geometry.dispose()
      chips?.material.dispose()
      chips?.texture.dispose()
    },
    [chips],
  )

  // Chips show near the camera target only, like the line letters.
  useEffect(() => {
    if (!(controls instanceof MapControls)) return
    const update = () =>
      setChipsVisible(controls.getDistance() <= config.landmarks.labelMaxDistanceM)
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [controls, config.landmarks.labelMaxDistanceM])

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
            _anchor.set(entry.frame.anchor.x, groundY, -entry.frame.anchor.y).project(camera)
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
              lod: landmarkLod(config.landmarks, tier, settings.lodDistanceScale, isBridge(entry)),
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
  ])

  if (built === null) return null
  return (
    <group name="landmarks">
      {landmarks.map((entry) => {
        const lod = landmarkLod(config.landmarks, tier, settings.lodDistanceScale, isBridge(entry))
        const glbLevels = glbOf(entry.id)
        if (glbLevels !== undefined) {
          // A teaser draws dimmed and flat, like its kit. A memorial never glows, so it never
          // takes the window-masked material: the kit's plain body (vertex colours, no glow).
          const glbMaterialOf =
            entry.style === 'teaser'
              ? materials.dimmed
              : isNightGlowExcluded(entry.category)
                ? materials.body
                : glbMaterial.material
          return (
            <Detailed
              key={entry.id}
              ref={(object: LOD | null) => {
                if (object === null) lods.current.delete(entry.id)
                else lods.current.set(entry.id, object)
              }}
              name={`landmark-${entry.id}`}
              position={[entry.frame.anchor.x, 0, -entry.frame.anchor.y]}
              rotation={[0, (-entry.frame.headingDeg * Math.PI) / 180, 0]}
              distances={[...lod.distances.slice(0, glbLevels.length), lod.cullM]}
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
            position={[entry.frame.anchor.x, 0, -entry.frame.anchor.y]}
            distances={[...lod.distances.slice(0, model.levels.length), lod.cullM]}
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
