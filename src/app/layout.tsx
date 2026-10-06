import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { copy } from '@/lib/copy'
import { paletteStyle, themeColorHex } from '@/lib/theme'
import './globals.css'

const APP_NAME = copy('app.name')

export const metadata: Metadata = {
  title: { default: `${APP_NAME} | ${copy('app.tagline')}`, template: `%s | ${APP_NAME}` },
  description: copy('app.description'),
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: copy('app.shortName'), statusBarStyle: 'black-translucent' },
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
  themeColor: themeColorHex(),
  colorScheme: 'dark',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" style={paletteStyle()}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
