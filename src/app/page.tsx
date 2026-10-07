import { EventSheetMount } from '@/components/events/EventSheetMount'
import { CloutHudMount } from '@/components/hud/CloutHudMount'
import { LevelUpToastMount } from '@/components/hud/LevelUpToastMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { PlaceSheetMount } from '@/components/places/PlaceSheetMount'
import { WelcomeMount } from '@/components/welcome/WelcomeMount'
import { copy } from '@/lib/copy'

export default function HomePage() {
  return (
    <OverlayLayout
      modal={<WelcomeMount />}
      slots={{
        hud: (
          <header className="relative flex h-full flex-col justify-center px-4">
            <h1 className="text-lg font-extrabold tracking-tight text-pink-400">
              {copy('app.name')}
            </h1>
            <p className="text-xs text-ink-300">{copy('app.tagline')}</p>
            <CloutHudMount />
          </header>
        ),
        toast: <LevelUpToastMount />,
        sheet: (
          <>
            <EventSheetMount />
            <PlaceSheetMount />
          </>
        ),
        tabs: <BottomTabs />,
      }}
    >
      {/* Scene placeholder until the 3D city lands in S04a. */}
      <div
        aria-hidden="true"
        className="h-full w-full bg-gradient-to-b from-night-800 via-night-900 to-night-950"
      />
    </OverlayLayout>
  )
}
