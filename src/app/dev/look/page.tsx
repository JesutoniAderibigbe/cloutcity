import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { publicAvatar, randomLook, repairLook } from '@/engine/appearance'
import { engineConfig } from '@/engine/config'
import { LookPreviewClient } from './LookPreviewClient'

export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * /dev/look (S16a): one look in the creator's avatar preview (src/scene/avatar/
 * AvatarPreviewCanvas.tsx), for review screenshots and the e2e preview checks. Test builds only
 * (NEXT_PUBLIC_TEST_HOOKS=1); every other build answers 404. Query: `seed` (a random look), or
 * any look field by name (`hairStyle=afro&eyewear=glasses`, over the seed's look or the
 * defaults; unknown ids fall back to the default), `worn` (item ids, comma-separated) and
 * `tier` (low|mid|high).
 */
export default async function LookPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') notFound()
  const params = await searchParams
  const text = (key: string) => (typeof params[key] === 'string' ? params[key] : undefined)
  const seed = Number(text('seed'))
  const base = Number.isFinite(seed) ? randomLook(seed, engineConfig) : engineConfig.avatar.defaults
  const fields = Object.fromEntries(
    Object.keys(base).flatMap((key) => {
      const value = text(key)
      return value === undefined ? [] : [[key, value]]
    }),
  )
  const look = repairLook({ ...base, ...fields }, engineConfig).look
  const worn = (text('worn') ?? '').split(',').filter((id) => id.length > 0)
  const tier = text('tier')
  return (
    <main className="h-full w-full">
      <h1 className="sr-only">Look preview</h1>
      <LookPreviewClient
        avatar={{
          ...publicAvatar({ look, inventory: { wearables: [], gifts: [], outfit: {}, decor: [] } }),
          worn,
        }}
        tier={tier === 'low' || tier === 'mid' ? tier : 'high'}
      />
    </main>
  )
}
