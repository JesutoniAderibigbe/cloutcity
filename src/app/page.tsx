import { SoundControlMount } from '@/components/audio/SoundControlMount'
import { SoundSheetMount } from '@/components/audio/SoundSheetMount'
import { EventSheetMount } from '@/components/events/EventSheetMount'
import { CloutHudMount } from '@/components/hud/CloutHudMount'
import { LevelUpToastMount } from '@/components/hud/LevelUpToastMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { ScenePlaceholder } from '@/components/overlay/ScenePlaceholder'
import { PlaceSheetMount } from '@/components/places/PlaceSheetMount'
import { WelcomeMount } from '@/components/welcome/WelcomeMount'
import { copy } from '@/lib/copy'

export default function HomePage() {
  return (
    <OverlayLayout
      modal={<WelcomeMount />}
      slots={{
        hud: (
          <div className="flex h-full items-center justify-between gap-3 px-4">
            <header className="flex min-w-0 flex-col justify-center">
              <h1 className="truncate text-lg font-extrabold tracking-tight text-pink-400">
                {copy('app.name')}
              </h1>
              <p className="truncate text-xs text-ink-300">{copy('app.tagline')}</p>
            </header>
            <div className="flex min-w-0 items-center gap-2">
              <CloutHudMount />
              <SoundControlMount />
            </div>
          </div>
        ),
        toast: <LevelUpToastMount />,
        sheet: (
          <>
            <EventSheetMount />
            <PlaceSheetMount />
            <SoundSheetMount />
          </>
        ),
        tabs: <BottomTabs />,
      }}
    >
      {/* Scene placeholder until the 3D city lands in S04a; it marks the map playable. */}
      <ScenePlaceholder />
    </OverlayLayout>
  )
}
