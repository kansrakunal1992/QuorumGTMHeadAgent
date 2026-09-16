import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quorum GTM Head',
  description: 'Founder Dashboard — autonomous GTM operator for Quorum',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
