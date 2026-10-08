/**
 * Place plots (S04m, DEC-59): where each playable place and home stands on its own plot, and
 * what dresses it, as pure data for the lazy plots chunk (src/scene/plots/layer.ts) and the
 * buildings layer's clearance (src/scene/buildings/layer.ts). No three, no React.
 *
 * A plot is a square of `plotM` centred on the place's point (where its pin and bubble stand),
 * with the building `buildingBackM` north of it, so the front yard faces the camera (which looks
 * north). Trees stand at the yard's corners, front corners first; bushes line the front edge.
 */
import type { QualityTier } from '@/lib/data/schemas/config'
import type { PlotApron, PlotsConfig } from '@/lib/data/schemas/scene'
import type { LocalPoint } from '@/lib/geo/projection'

/** What a plot is planned from: a venue pin, or a home (`category: 'home'`). */
export interface PlotPlace {
  readonly id: string
  readonly kind: 'venue' | 'landmark' | 'home'
  readonly category: string
  readonly style?: string
  readonly x: number
  readonly y: number
}

/** One model on a plot, in local metres (x east, y north), turned `rotation` about up. */
export interface PlotPart {
  readonly model: string
  readonly x: number
  readonly y: number
  readonly rotation: number
  /** Uniform scale; for the building, the runtime fits it to `footprintM` instead. */
  readonly scale: number
  /** Recolour of the model's slot, as theme tokens (slot name → token). */
  readonly slots: Readonly<Record<string, string>>
}

export interface PlotPlan {
  readonly id: string
  readonly x: number
  readonly y: number
  /** What paves the front yard. */
  readonly apron: PlotApron
  /** The building, fitted to `footprintM` by its longer side; null on a plot without one. */
  readonly building: (PlotPart & { readonly footprintM: number }) | null
  /** An awning across the building's front (placed by the runtime against its facade). */
  readonly awning: PlotPart | null
  readonly dressing: readonly PlotPart[]
}

/** The square a plot keeps clear of district buildings and fill blocks. */
export interface PlotClearing {
  readonly x: number
  readonly y: number
  /** Half the square's side, clearance included. */
  readonly half: number
}

/**
 * The plots: one per venue whose category has a style (normal style only: teasers and memorials
 * keep their pins) and one per home. Landmarks never get one: they have their own models.
 */
export function planPlots(
  places: readonly PlotPlace[],
  config: PlotsConfig,
  tier?: QualityTier,
): PlotPlan[] {
  // Dressing (trees, bushes, awnings) only on the tiers that draw it (`dressingTiers`); no tier
  // plans it all.
  const dressed = tier === undefined || config.dressingTiers.includes(tier)
  const plans: PlotPlan[] = []
  for (const place of places) {
    if (place.kind === 'landmark') continue
    if (place.style !== undefined && place.style !== 'normal') continue
    const style = config.styles[place.category]
    if (style === undefined) continue
    const half = config.plotM / 2
    const inset = half - config.trees.insetM
    const corners: [number, number][] = [
      [-inset, -inset],
      [inset, -inset],
      [-inset, inset],
      [inset, inset],
    ]
    const dressing: PlotPart[] = corners.slice(0, dressed ? style.trees : 0).map(([dx, dy], i) => ({
      model: config.trees.models[i % config.trees.models.length] ?? config.trees.models[0] ?? '',
      x: place.x + dx,
      y: place.y + dy,
      rotation: i * 1.3,
      scale: config.trees.scale,
      slots: {},
    }))
    // Bushes along the front edge, centred, between the front trees.
    const row = -(half - config.kerbM - 2)
    for (let i = 0; i < (dressed ? style.bushes : 0); i++) {
      const dx = (i - (style.bushes - 1) / 2) * config.bush.spacingM
      dressing.push({
        model: config.bush.model,
        x: place.x + dx,
        y: place.y + row,
        rotation: i * 0.9,
        scale: config.bush.scale,
        slots: {},
      })
    }
    const by = place.y + config.buildingBackM
    plans.push({
      id: place.id,
      x: place.x,
      y: place.y,
      apron: style.apron,
      building:
        style.model === null
          ? null
          : {
              model: style.model,
              x: place.x,
              y: by,
              rotation: 0,
              scale: 1,
              footprintM: style.footprintM,
              slots: style.facade === null ? {} : { facade: style.facade },
            },
      awning:
        !dressed || style.awning === null || style.model === null
          ? null
          : {
              model: style.awning.model,
              x: place.x,
              y: by,
              rotation: 0,
              scale: 1,
              slots: { canvas: style.awning.color },
            },
      dressing,
    })
  }
  return plans
}

/** Venue pins and homes as plot places (homes first, so a home wins a shared id). */
export function plotPlaces(
  pins: readonly (Omit<PlotPlace, 'kind'> & { readonly kind: string })[],
  homes: readonly { readonly id: string; readonly x: number; readonly y: number }[],
): PlotPlace[] {
  return [
    ...homes.map((home) => ({ ...home, kind: 'home' as const, category: 'home' })),
    ...pins
      .filter((pin) => pin.kind === 'venue')
      .map((pin) => ({ ...pin, kind: 'venue' as const })),
  ]
}

/** Each plot's clearing: its square grown by `clearM`. */
export function plotClearings(
  plans: readonly Pick<PlotPlan, 'x' | 'y'>[],
  config: Pick<PlotsConfig, 'plotM' | 'clearM'>,
): PlotClearing[] {
  const half = config.plotM / 2 + config.clearM
  return plans.map((plan) => ({ x: plan.x, y: plan.y, half }))
}

/** Whether a point (local metres) lies in a clearing, grown by `margin`. */
export function inClearing(
  point: LocalPoint,
  clearings: readonly PlotClearing[],
  margin = 0,
): boolean {
  for (const c of clearings) {
    const reach = c.half + margin
    if (Math.abs(point.x - c.x) <= reach && Math.abs(point.y - c.y) <= reach) return true
  }
  return false
}

/** A model's bounds (data/assets/manifest.json), metres, pivot at the bottom centre. */
export interface ModelBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

/** The uniform scale that fits a building model's longer side to `footprintM`. */
export function buildingScale(bounds: ModelBounds, footprintM: number): number {
  const side = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2])
  return side > 0 ? footprintM / side : 1
}

/**
 * How far above the land top each venue's pin floats (S04m): over its plot's building with
 * `bubbleClearM` to spare, so the icon bubble sits over the roof like a game map's. Venues
 * without a building (or a style) are left out: their pins stay on the ground.
 */
export function plotPinLifts(
  places: readonly PlotPlace[],
  config: PlotsConfig,
  bounds: (model: string) => ModelBounds | undefined,
): Map<string, number> {
  const lifts = new Map<string, number>()
  for (const plan of planPlots(places, config)) {
    if (plan.building === null) continue
    const box = bounds(plan.building.model)
    if (box === undefined) continue
    const height =
      (box.max[1] - box.min[1]) *
      buildingScale(box, plan.building.footprintM) *
      config.buildingHeightScale
    lifts.set(plan.id, Math.round(config.slabM + height + config.bubbleClearM))
  }
  return lifts
}

/** Every theme token the plots draw with (the server resolves these to hex). */
export function plotTokens(config: PlotsConfig): string[] {
  const tokens = new Set<string>([
    config.lawn,
    config.kerb,
    config.aprons.plaza,
    config.aprons.parking,
    config.stripe.color,
    config.roof.from,
    config.roof.to,
    config.areas.water.fill,
    config.areas.neighborhood.fill,
  ])
  for (const look of [config.areas.water, config.areas.neighborhood]) {
    if (look.halo !== null) tokens.add(look.halo)
  }
  for (const style of Object.values(config.styles)) {
    if (style.facade !== null) tokens.add(style.facade)
    if (style.awning !== null) tokens.add(style.awning.color)
  }
  return [...tokens].sort()
}

/** Every model the plots draw. */
export function plotModels(config: PlotsConfig): string[] {
  const models = new Set<string>([...config.trees.models, config.bush.model])
  for (const style of Object.values(config.styles)) {
    if (style.model !== null) models.add(style.model)
    if (style.awning !== null) models.add(style.awning.model)
  }
  return [...models].sort()
}
