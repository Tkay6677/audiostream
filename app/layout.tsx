import './globals.css'
import { ReactNode } from 'react'

export const metadata = {
  title: 'Audio Streaming App',
  description: 'Stream audio to multiple participants in real-time',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
