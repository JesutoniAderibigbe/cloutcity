'use client'

/**
 * The creator's avatar preview (S16a, A2.3): a second, small WebGL canvas with the player's look
 * under a fixed studio light (scene.json `avatarLook.preview`, D11), so swatches always read true
 * whatever the time of day. Its own lazy chunk (the creator imports it with next/dynamic), not
 * counted on the playable path.
 *
 * - The city hands it the screen while it is open (src/state/sceneFocus.ts `creator`): the map
 *   renders no frames, so only one scene draws.
 * - It renders on demand. The idle clip plays (a frame lease) only while the preview is on
 *   screen, the tab is visible and the player has not asked for reduced motion; otherwise the
 *   avatar is posed once and nothing more is drawn.
 * - Closing it loses its WebGL context at once (react-three-fiber's unmount calls
 *   forceContextLoss), so a phone never holds two.
 * - Without WebGL2 it draws nothing and shows `fallback` instead (the creator's DOM summary of
 *   the look, with every colour named, A11Y-3).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type { PublicAvatar } from '@/engine/appearance'
import type { QualityTier } from '@/lib/data/schemas/config'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { setSceneFocus } from '@/state/sceneFocus'
import type { AvatarStatus } from '../models/AvatarModel'
import { ModelsProvider } from '../models/runtime'
import { modelsConfig } from '../apartment/modelsConfig'
import { webgl2Available } from '../webgl'
import { avatarRefs, LookAvatar } from './LookAvatar'
import type { ResolvedLook } from './resolveLook'

/** Name of the preview avatar's group (the preview test hook finds it). */
export const PREVIEW_AVATAR_NAME = 'preview-avatar'

export interface AvatarPreviewTestHook {
  frames(): number
  pendingFrames(): number
  status(): AvatarStatus
  /** What the look resolved to, or null before it has. */
  look(): { head: string; body: string; attachments: string[]; missing: string[] } | null
  /** True while the idle clip holds a frame lease. */
  animating(): boolean
}

declare global {
  interface CloutcityTestHooks {
    avatarPreview?: AvatarPreviewTestHook
    /** Set when a preview canvas closed: whether its context was lost on the way out. */
    avatarPreviewClosed?: { contextLost: boolean }
  }
}

const preview = avatarRefs.preview

/** Whether `element` is on screen (an IntersectionObserver), and the tab visible. */
function useOnScreen(element: HTMLElement | null): boolean {
  const [onScreen, setOnScreen] = useState(true)
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry?.isIntersecting ?? true),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return onScreen && visible
}

/** Installs the test hook while open, and records on close that the context was lost. */
function PreviewLifecycle({
  status,
  resolved,
  animating,
}: {
  readonly status: AvatarStatus
  readonly resolved: ResolvedLook | null
  readonly animating: boolean
}) {
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)
  useEffect(
    () => () => {
      // react-three-fiber loses the context itself when the canvas unmounts (a second
      // forceContextLoss only logs a warning); the test hook records that it did.
      if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
      const context = gl.getContext()
      setTimeout(() => {
        window.__cloutcityTest = {
          ...window.__cloutcityTest,
          avatarPreviewClosed: { contextLost: context.isContextLost() },
        }
      }, 0)
    },
    [gl],
  )
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    const hook: AvatarPreviewTestHook = {
      frames: () => gl.info.render.frame,
      pendingFrames: () => get().internal.frames,
      status: () => status,
      look: () =>
        resolved === null
          ? null
          : {
              head: resolved.parts.head.id,
              body: resolved.parts.body.id,
              attachments: (resolved.parts.attachments ?? []).map((part) => part.ref.id),
              missing: [...resolved.missing],
            },
      animating: () => animating,
    }
    window.__cloutcityTest = { ...window.__cloutcityTest, avatarPreview: hook }
    return () => {
      delete window.__cloutcityTest?.avatarPreview
    }
  }, [gl, get, status, resolved, animating])
  return null
}

export default function AvatarPreviewCanvas({
  avatar,
  tier,
  label,
  fallback,
}: {
  readonly avatar: PublicAvatar
  readonly tier: QualityTier
  /** The canvas's accessible name ("Your look"). */
  readonly label: string
  /** Shown instead of the canvas without WebGL2 (the look as text, every colour named). */
  readonly fallback: ReactNode
}) {
  const [canDraw] = useState(() => webgl2Available())
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<AvatarStatus>('loading')
  const [resolved, setResolved] = useState<ResolvedLook | null>(null)
  const reducedMotion = useReducedMotion()
  const onScreen = useOnScreen(element)
  const [config] = useState(modelsConfig)
  const animating = canDraw && onScreen && !reducedMotion && status === 'ready'

  useEffect(() => {
    if (!canDraw) return
    setSceneFocus('creator')
    return () => setSceneFocus('city')
  }, [canDraw])

  if (!canDraw) return <>{fallback}</>
  return (
    <div ref={setElement} role="img" aria-label={label} className="relative h-full w-full">
      <Canvas
        frameloop="demand"
        dpr={[1, tier === 'low' ? 1 : 1.5]}
        flat
        gl={{ antialias: tier !== 'low', alpha: false, stencil: false }}
        camera={{ fov: preview.camera.fovDeg, position: [...preview.camera.position] }}
        onCreated={({ camera }) => camera.lookAt(...preview.camera.target)}
      >
        <color attach="background" args={[preview.background]} />
        <ambientLight color={preview.ambient.color} intensity={preview.ambient.intensity} />
        <hemisphereLight
          args={[preview.hemisphere.sky, preview.hemisphere.ground, preview.hemisphere.intensity]}
        />
        <directionalLight
          color={preview.sun.color}
          intensity={preview.sun.intensity}
          position={[...preview.sun.position]}
        />
        <ModelsProvider config={config} tier={tier}>
          <group name={PREVIEW_AVATAR_NAME}>
            <LookAvatar
              avatar={avatar}
              clip={preview.clip}
              animate={animating}
              onStatus={setStatus}
              onResolved={setResolved}
            />
          </group>
        </ModelsProvider>
        <PreviewLifecycle status={status} resolved={resolved} animating={animating} />
      </Canvas>
    </div>
  )
}
