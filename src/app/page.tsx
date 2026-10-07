import { SoundSheetMount } from '@/components/audio/SoundSheetMount'
import { EventSheetMount } from '@/components/events/EventSheetMount'
import { IconMomentMount } from '@/components/goals/IconMomentMount'
import { HudFrame } from '@/components/hud/HudFrame'
import { HudPanelMount } from '@/components/hud/HudPanelMount'
import { LevelUpToastMount } from '@/components/hud/LevelUpToastMount'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { OverlayLayout } from '@/components/overlay/OverlayLayout'
import { PlaceSheetMount } from '@/components/places/PlaceSheetMount'
import { WelcomeMount } from '@/components/welcome/WelcomeMount'
import { CityScene } from '@/scene/CityScene'

export default function HomePage() {
  return (
    <OverlayLayout
      modal={
        <>
          <WelcomeMount />
          <IconMomentMount />
        </>
      }
      slots={{
        hud: <HudFrame />,
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
