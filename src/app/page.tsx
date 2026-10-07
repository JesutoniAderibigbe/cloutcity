import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { copy } from '@/lib/copy'
import { CityScene } from '@/scene/CityScene'

export default function HomePage() {
  return (
    <OverlayLayout
      slots={{
        hud: (
          <header className="flex h-full flex-col justify-center px-4">
            <h1 className="text-lg font-extrabold tracking-tight text-pink-400">
              {copy('app.name')}
            </h1>
            <p className="text-xs text-ink-300">{copy('app.tagline')}</p>
          </header>
        ),
        tabs: <BottomTabs />,
      }}
    >
      <CityScene />
    </OverlayLayout>
  )
}
