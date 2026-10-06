import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

const APP_NAME = 'Clout City: NYC'
const TAGLINE = 'Tap In. Blow Up.'
const THEME_COLOR = '#0d0a24'

export const metadata: Metadata = {
  title: { default: `${APP_NAME} | ${TAGLINE}`, template: `%s | ${APP_NAME}` },
  description: `${TAGLINE} Make it in New York.`,
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: 'Clout City', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  icons: { apple: '/icons/apple-touch-icon.png' },
}

// Locked to the device width with content drawn under the notch (safe areas are handled by the
// overlay layout). Pinch zoom is deliberately left enabled: disabling it fails WCAG 1.4.4, and the
// shell blocks scroll, bounce and double-tap zoom in CSS instead.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: THEME_COLOR,
  colorScheme: 'dark',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
