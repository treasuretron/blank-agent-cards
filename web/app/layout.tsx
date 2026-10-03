import type { Metadata } from "next"
import localFont from "next/font/local"
import type { ReactNode } from "react"
import { RoomProvider } from "@/lib/room"
import "./globals.css"

const hand = localFont({ src: "./fonts/PatrickHand-Regular.ttf", variable: "--font-hand", display: "swap" })

export const metadata: Metadata = {
  title: "1000 Blank Agent Cards",
  description: "Draw the cards. The deck decides the game.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={hand.variable}>
      <body>
        <RoomProvider>{children}</RoomProvider>
      </body>
    </html>
  )
}
