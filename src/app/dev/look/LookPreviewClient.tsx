'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { PublicAvatar } from '@/engine/appearance'
import type { QualityTier } from '@/lib/data/schemas/config'

// The preview canvas loads in its own lazy chunk, as it will from the creator (A3).
const AvatarPreviewCanvas = dynamic(() => import('@/scene/avatar/AvatarPreviewCanvas'), {
  ssr: false,
})

/** The preview, and a Close button that unmounts it (the context-loss check). */
export function LookPreviewClient({
  avatar,
  tier,
}: {
  readonly avatar: PublicAvatar
  readonly tier: QualityTier
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="relative h-full w-full">
      {open && (
        <AvatarPreviewCanvas
          avatar={avatar}
          tier={tier}
          label="Your look"
          fallback={<p>{Object.values(avatar.look).join(', ')}</p>}
        />
      )}
      <button
        type="button"
        className="absolute top-2 right-2 min-h-11 rounded glass px-3 text-fg"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Close preview' : 'Open preview'}
      </button>
    </div>
  )
}
