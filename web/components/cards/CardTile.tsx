"use client"

import type { CardView } from "@cards/shared"
import { useState, type ReactNode } from "react"
import { useRoom } from "@/lib/room"
import styles from "./cards.module.css"

// One composited card image as the server serves it. Falls back to the card's
// face text if the image can't be loaded (e.g. not yet authorized).
export function CardTile({
  card,
  aspect,
  size = "small",
  children,
}: {
  card: Pick<CardView, "title" | "text" | "imageUrl">
  aspect: string
  size?: "small" | "medium" | "large"
  children?: ReactNode
}) {
  const { imageUrl } = useRoom()
  const [broken, setBroken] = useState(false)
  const alt = [card.title, card.text].filter(Boolean).join(" — ") || "Untitled card"
  return (
    <div className={styles.tile}>
      <div className={`${styles.face} ${styles[size]}`} style={{ aspectRatio: aspect }}>
        {broken ? (
          <div className={styles.fallback}>
            {card.title && <strong>{card.title}</strong>}
            <div>{card.text}</div>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by the game server, not Next
          <img src={imageUrl(card)} alt={alt} loading="lazy" onError={() => setBroken(true)} />
        )}
      </div>
      {children}
    </div>
  )
}

export function EmptySlot({ aspect, label }: { aspect: string; label: string }) {
  return (
    <div className={styles.tile}>
      <div className={styles.slot} style={{ aspectRatio: aspect }}>{label}</div>
    </div>
  )
}
