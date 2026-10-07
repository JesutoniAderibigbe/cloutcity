import { SoundControl } from '@/components/audio/SoundControl'
import { SoundSheetSlot } from '@/components/audio/SoundSheetSlot'
import { EventSheetMount } from '@/components/events/EventSheetMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { ScenePlaceholder } from '@/components/overlay/ScenePlaceholder'
import { WelcomeGate } from '@/components/welcome/WelcomeGate'
import { copy } from '@/lib/copy'

export default function HomePage() {
  return (
    <OverlayLayout
      modal={<WelcomeGate />}
      slots={{
        hud: (
          <div className="flex h-full items-center justify-between gap-2 px-4">
            <header className="flex min-w-0 flex-col justify-center">
              <h1 className="truncate text-lg font-extrabold tracking-tight text-pink-400">
                {copy('app.name')}
              </h1>
              <p className="truncate text-xs text-ink-300">{copy('app.tagline')}</p>
            </header>
            <SoundControl />
          </div>
        ),
        sheet: (
          <>
            <EventSheetMount />
            <SoundSheetSlot />
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
