"use client"

import type { CardView } from "@cards/shared"
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { CardTile } from "./CardTile"
import styles from "./cards.module.css"

// One card, popped up over the whole UI until you click it away again. Rendered
// into <body> so it clears the scrolling hand and thread it was clicked in.
export function CardZoom({
  card,
  aspect,
  onClose,
}: {
  card: Pick<CardView, "title" | "text" | "imageUrl">
  aspect: string
  onClose(): void
}) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    layer.current?.focus()
    // Nothing underneath should scroll while a card is held up.
    const root = document.documentElement
    const scrollable = root.style.overflow
    root.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      root.style.overflow = scrollable
      before?.focus?.()
    }
  }, [onClose])

  const label = card.title ?? "Untitled card"
  return createPortal(
    <div
      ref={layer}
      className={styles.zoomLayer}
      role="dialog"
      aria-modal="true"
      aria-label={`${label}, enlarged`}
      tabIndex={-1}
      // The card is inside this layer, so clicking the card itself dismisses it too.
      onClick={onClose}
    >
      <CardTile card={card} aspect={aspect} size="zoom" />
      <p className={styles.zoomHint}>click anywhere to put it back</p>
    </div>,
    document.body,
  )
}