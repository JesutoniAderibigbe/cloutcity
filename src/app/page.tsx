import { SoundControlMount } from '@/components/audio/SoundControlMount'
import { SoundSheetMount } from '@/components/audio/SoundSheetMount'
import { EventSheetMount } from '@/components/events/EventSheetMount'
import { CloutHudMount } from '@/components/hud/CloutHudMount'
import { HudPanelButtonsMount } from '@/components/hud/HudPanelButtonsMount'
import { HudPanelMount } from '@/components/hud/HudPanelMount'
import { LevelUpToastMount } from '@/components/hud/LevelUpToastMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { PlaceSheetMount } from '@/components/places/PlaceSheetMount'
import { WelcomeMount } from '@/components/welcome/WelcomeMount'
import { copy } from '@/lib/copy'
import { CityScene } from '@/scene/CityScene'

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
            {/* Below sm the controls are fixed-width icons, so the title truncates instead
                (S05 splits the HUD into two rows); from sm up the sound control's text shrinks. */}
            <div className="flex shrink-0 items-center gap-2 sm:min-w-0 sm:shrink">
              <CloutHudMount />
              <HudPanelButtonsMount />
              <SoundControlMount />
            </div>
          </div>
        ),
        toast: <LevelUpToastMount />,
        sheet: (
          <>
            <EventSheetMount />
            <PlaceSheetMount />
            <HudPanelMount />
            <SoundSheetMount />
          </>
        ),
        tabs: <BottomTabs />,
      }}
    >
      <CityScene />
    </OverlayLayout>
  )
}
