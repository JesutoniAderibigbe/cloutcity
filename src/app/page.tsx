import { EventSheetMount } from '@/components/events/EventSheetMount'
import { HudPanelButtons } from '@/components/hud/HudPanelButtons'
import { HudPanelMount } from '@/components/hud/HudPanelMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { PlaceSheetMount } from '@/components/places/PlaceSheetMount'
import { WelcomeGate } from '@/components/welcome/WelcomeGate'
import { copy } from '@/lib/copy'

export default function HomePage() {
  return (
    <OverlayLayout
      modal={<WelcomeGate />}
      slots={{
        hud: (
          <header className="flex h-full items-center justify-between gap-2 px-4">
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight text-pink-400">
                {copy('app.name')}
              </h1>
              <p className="text-xs text-ink-300">{copy('app.tagline')}</p>
            </div>
            <HudPanelButtons />
          </header>
        ),
        sheet: (
          <>
            <EventSheetMount />
            <PlaceSheetMount />
            <HudPanelMount />
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
