"use client"

import type { CardView } from "@cards/shared"
import { useEffect, useState } from "react"
import { CardTile } from "@/components/cards/CardTile"
import { CardZoom } from "@/components/cards/CardZoom"
import cardStyles from "@/components/cards/cards.module.css"
import styles from "./game.module.css"

// Your hand. Clicking a card pops it up over the table to read it, and picking it
// and playing it stay separate steps so a stray click can't throw away a turn.
export function Hand({
  cards,
  aspect,
  canPlay,
  onPlay,
}: {
  cards: CardView[]
  aspect: string
  canPlay: boolean
  onPlay(cardId: string): void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState<CardView | null>(null)
  useEffect(() => {
    if (selected && !cards.some((c) => c.id === selected)) setSelected(null)
  }, [cards, selected])
  useEffect(() => {
    if (zoom && !cards.some((c) => c.id === zoom.id)) setZoom(null)
  }, [cards, zoom])

  if (!cards.length) return <p className={styles.sub}>Your hand is empty.</p>
  return (
    <div className={styles.hand} aria-label="Your hand">
      {cards.map((c) => {
        const isSel = selected === c.id
        return (
          <div
            key={c.id}
            className={`${styles.handCard} ${isSel ? styles.selected : ""}`}
          >
            <button
              type="button"
              aria-pressed={isSel}
              className={cardStyles.zoomTrigger}
              onClick={() => {
                setSelected(c.id)
                setZoom(c)
              }}
              aria-label={`${c.title ?? "Untitled"}: ${c.text}`}
            >
              <CardTile card={c} aspect={aspect} size="medium" />
            </button>
            {isSel && (
              <button type="button" className="primary" disabled={!canPlay} onClick={() => onPlay(c.id)}>
                play this card
              </button>
            )}
          </div>
        )
      })}
      {zoom && <CardZoom card={zoom} aspect={aspect} onClose={() => setZoom(null)} />}
    </div>
  )
}
