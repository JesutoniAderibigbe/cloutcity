'use client'

/**
 * District buildings and procedural blocks on the map (S04d). Mounted with the city but idle
 * until the city's first frame (`active`): then the active tier's files load and build in time
 * slices, nearest district first, without delaying the playable map (PERF-4). The tier sets the
 * files, the share of buildings drawn (`buildingDensity`), the draw distances
 * (`lodDistanceScale`) and whether walls get windows, which glow with the shared night-glow
 * uniform (src/scene/lighting/nightGlow.ts; S04f's day/night rig drives it). Nothing here is
 * pickable. The layer and its builders load as their own chunk once the city has drawn, so they
 * stay off the playable path (PERF-6); the tier also sets how the procedural blocks are dressed
 * (S04i fill-lite: lots, plates, street trees).
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Group, type Texture } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { DistrictAssets } from '@/lib/data/districts'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CitySceneConfig } from '@/lib/data/schemas/scene'
import { log } from '@/lib/log'
import type { BoroughId } from '../geo/schema'
import { dimmedColor } from '../materials'
import { useTierSettings } from '../quality/tierSettings'
import type { ScenePalette } from '../types'
import type { BlockFill } from './buildBlocks'
import type { BuildingsLayer, BuildingsLayerView, createBuildingsLayer } from './layer'
import { useNightGlow } from '../lighting/nightGlow'
import { createBuildingMaterial, createWindowMask, windowTile } from './materials'

/** What the e2e hook reads (src/scene/testHooks.tsx). */
export interface BuildingsState extends BuildingsLayerView {
  readonly windows: boolean
  /** The shared night-glow uniform's value now (0 by day, 1 at night). */
  readonly nightGlow: number
}

export interface BuildingsHandle {
  state(): BuildingsState | null
}

interface BuildingsProps {
  readonly assets: Readonly<Record<QualityTier, DistrictAssets>>
  readonly palette: ScenePalette
  readonly config: CitySceneConfig
  readonly groundY: number
  /** The city's shared toon ramp. */
  readonly gradientMap: Texture
  readonly dimmedBoroughs: ReadonlySet<BoroughId>
  /** The city has drawn its first frame: loading may start. */
  readonly active: boolean
  readonly handleRef: RefObject<BuildingsHandle | null>
}

export function Buildings({
  assets,
  palette,
  config,
  groundY,
  gradientMap,
  dimmedBoroughs,
  active,
  handleRef,
}: BuildingsProps) {
  const settings = useTierSettings()
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  const glow = useNightGlow()
  const root = useMemo(() => {
    const group = new Group()
    group.name = 'district-buildings'
    return group
  }, [])
  const layerRef = useRef<BuildingsLayer | null>(null)

  const tierAssets = assets[settings.tier]
  const shadowKey = `${settings.shadows}:${settings.shadowMapSizePx}`
  const windows = config.buildings.windows[settings.tier]
  const materials = useMemo(() => {
    const mask = windows ? createWindowMask(config.buildings) : null
    return {
      mask,
      district: createBuildingMaterial({
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
      }),
      blocks: createBuildingMaterial({ gradientMap, colors: 'instance' }),
      blocksDimmed: createBuildingMaterial({ gradientMap, colors: 'instance' }),
    }
    // A shadow change (tier step) rebuilds the set: the old materials, out of the scene while
    // the new tier's layer loads, would otherwise keep their old programs compiled (3D-3).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradientMap, palette.buildings.window, config.buildings, windows, glow, shadowKey])
  useEffect(
    () => () => {
      materials.district.dispose()
      materials.blocks.dispose()
      materials.blocksDimmed.dispose()
      materials.mask?.dispose()
    },
    [materials],
  )

  // Density and draw distances follow the tier without a reload.
  const tierView = useRef({ density: settings.buildingDensity, scale: settings.lodDistanceScale })
  useEffect(() => {
    tierView.current = { density: settings.buildingDensity, scale: settings.lodDistanceScale }
    layerRef.current?.setDensity(settings.buildingDensity)
    layerRef.current?.setDistanceScale(settings.lodDistanceScale)
  }, [settings.buildingDensity, settings.lodDistanceScale])

  const fill = config.buildings.fill
  const blockFill = useMemo<BlockFill>(
    () => ({
      lots: fill.lots[settings.tier],
      plate: fill.plate[settings.tier],
      plateHeightM: fill.plateHeightM,
      lotGapM: fill.lotGapM,
      lotHeightJitter: fill.lotHeightJitter,
      treesPerBlock: fill.streetTreesPerBlock[settings.tier],
      treesMax: settings.fillTreesMax,
      treeViewM: fill.treeViewM[settings.tier],
      treeSizeM: fill.treeSizeM,
      treeWidthRatio: fill.treeWidthRatio,
    }),
    [fill, settings.tier, settings.fillTreesMax],
  )

  // Nothing loads before the city's first frame. Then the layer's chunk, and one layer per
  // tier's files (and material set), following the camera; a tier change replaces it.
  useEffect(() => {
    if (!active) return
    const mountLayer = (create: typeof createBuildingsLayer) => {
      const layer = create({
        assets: tierAssets,
        groundY,
        config: config.buildings,
        districtColors: {
          walls: palette.buildings.walls,
          roof: palette.buildings.roof,
          jitter: config.buildings.wallJitter,
          windowTile: windowTile(config.buildings),
        },
        blockColors: {
          blocks: palette.buildings.blocks,
          dimmed: `#${dimmedColor(palette.buildings.dimmedBlock, palette.haze, config.dimmed.towardBackground).getHexString()}`,
          jitter: config.buildings.wallJitter,
          lot: palette.buildings.lot,
          tree: palette.buildings.tree,
        },
        blockFill,
        dimmedBoroughs,
        materials: {
          district: materials.district,
          blocks: materials.blocks,
          blocksDimmed: materials.blocksDimmed,
        },
        prepare: async (object) => {
          if (gl.extensions.has('KHR_parallel_shader_compile')) {
            await gl.compileAsync(object, camera, scene)
          }
        },
        onChange: invalidate,
        onError: (url, reason) => log.warn('District buildings failed to load', { url, reason }),
      })
      layerRef.current = layer
      root.add(layer.group)
      layer.setDensity(tierView.current.density)
      layer.setDistanceScale(tierView.current.scale)
      layer.setView(camera)
      layer.start()
      const update = () => layer.setView(camera)
      const rig = controls instanceof MapControls ? controls : null
      rig?.addEventListener('change', update)
      return () => {
        rig?.removeEventListener('change', update)
        layer.dispose()
        if (layerRef.current === layer) layerRef.current = null
      }
    }
    let cancelled = false
    let release = () => {}
    import('./layer')
      .then((module) => {
        if (!cancelled) release = mountLayer(module.createBuildingsLayer)
      })
      .catch((error: unknown) =>
        log.warn('District buildings failed to load', {
          url: 'buildings layer chunk',
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
    return () => {
      cancelled = true
      release()
    }
  }, [
    active,
    blockFill,
    tierAssets,
    groundY,
    config,
    palette,
    dimmedBoroughs,
    materials,
    gl,
    camera,
    scene,
    controls,
    root,
    invalidate,
  ])

  useEffect(() => {
    handleRef.current = {
      state: () => {
        const view = layerRef.current?.view()
        return view === undefined ? null : { ...view, windows, nightGlow: glow.value }
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef, windows, glow])

  return <primitive object={root} />
}
