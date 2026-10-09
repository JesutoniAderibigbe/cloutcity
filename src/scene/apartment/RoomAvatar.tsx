'use client'

/**
 * The player's Sim in their apartment (S16a, S40c): the shared room Sim (sim/SimAvatar.tsx) in
 * the home's room. It stands at the home's `avatarAnchor`; a home action done in the Home panel
 * (src/state/roomActivity.ts) sends it to the bed to sleep or nap, to the fridge and stove to cook
 * and to a seat to eat; a tap on a sofa, chair or stool sits it there, and a tap on the floor gets
 * it up and walks it over. Where each piece is used comes from data
 * (data/homes/interactions.json), so new furniture needs no code; a home without the furniture
 * uses its fallback spot or does it standing.
 *
 * It is its own lazy chunk, loaded after the room is up, with the model runtime and the look
 * runtime, so the apartment chunk does not grow.
 */
import { useMemo } from 'react'
import type { HomeIdLiteral } from '@/lib/data/homes'
import type { QualityTier } from '@/lib/data/schemas/config'
import { onRoomActivity } from '@/state/roomActivity'
import { modelsConfig } from './modelsConfig'
import type { RoomInterior } from './data'
import { SimAvatar } from './sim/SimAvatar'
import type { Body } from './sim/simController'
import { simData } from './sim/simData'
import { buildWorld } from './sim/simWorld'
import { ROOM_AVATAR_NAME, type ApartmentPlacement } from './types'

const DEG = Math.PI / 180

const decorModels: Readonly<Record<string, { readonly model: string } | undefined>> =
  modelsConfig().decor

function worldOf(interior: RoomInterior, placed: Readonly<Record<string, ApartmentPlacement>>) {
  return buildWorld({
    grid: interior.grid,
    fixtures: interior.fixtures.map((fixture) =>
      fixture.kind === 'model'
        ? { kind: 'model', model: fixture.model, slotId: fixture.slotId, turn: fixture.turn }
        : { kind: 'counter', slotId: fixture.slotId, turn: fixture.turn },
    ),
    placed: Object.values(placed),
    modelOf: (itemId) => decorModels[itemId]?.model ?? null,
    walkable: simData.walkable,
  })
}

function anchorBody(interior: RoomInterior): Body {
  const [x, , z] = interior.avatarAnchor.position
  return { x, y: 0, z, yaw: interior.avatarAnchor.rotationDeg * DEG, tilt: 0 }
}

export default function RoomAvatar({
  home,
  interior,
  placed,
  gridShown,
  tier,
  toonRamp,
  avatarHeightM,
}: {
  readonly home: HomeIdLiteral
  readonly interior: RoomInterior
  /** Every item drawn now: the Sim walks around them and uses them. */
  readonly placed: Readonly<Record<string, ApartmentPlacement>>
  /** Buy mode's grid is up: taps place furniture, not the Sim. */
  readonly gridShown: boolean
  readonly tier: QualityTier
  readonly toonRamp: readonly number[]
  /** How tall the avatar stands in the room (scene.json `apartment.avatarHeightM`). */
  readonly avatarHeightM: number
}) {
  const world = useMemo(() => worldOf(interior, placed), [interior, placed])
  const start = useMemo(() => anchorBody(interior), [interior])
  return (
    <SimAvatar
      scope={home}
      data={simData}
      world={world}
      start={start}
      subscribe={onRoomActivity}
      tapsEnabled={!gridShown}
      floor={interior.room}
      tier={tier}
      toonRamp={toonRamp}
      avatarHeightM={avatarHeightM}
      name={ROOM_AVATAR_NAME}
    />
  )
}
