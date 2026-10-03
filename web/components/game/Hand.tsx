"use client"

import type { CardView } from "@cards/shared"
import { useEffect, useState } from "react"
import { CardTile } from "@/components/cards/CardTile"
import styles from "./game.module.css"

// Your hand. Picking a card and playing it are separate steps so a stray
// click can't throw away a turn.
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
  useEffect(() => {
    if (selected && !cards.some((c) => c.id === selected)) setSelected(null)
  }, [cards, selected])

  if (!cards.length) return <p className={styles.sub}>Your hand is empty.</p>
  return (
    <div className={styles.hand} aria-label="Your hand">
      {cards.map((c) => {
        const isSel = selected === c.id
        return (
          <div
            key={c.id}
            className={`${styles.handCard} ${isSel ? styles.selected : ""}`}
            // Keep the enlarged card in view when it's near the edge of a scrolled hand.
            onTransitionEnd={(e) => isSel && e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
          >
            <button
              type="button"
              aria-pressed={isSel}
              className={styles.cardButton}
              onClick={() => setSelected(isSel ? null : c.id)}
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
    </div>
  )
}
