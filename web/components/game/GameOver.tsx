"use client"

import type { RoomSnapshot } from "@cards/shared"
import Link from "next/link"
import { useState } from "react"
import { SaveCards } from "./SaveCards"
import styles from "./game.module.css"

export function GameOver({ snap }: { snap: RoomSnapshot }) {
  const [open, setOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  if (!open) {
    return (
      <button type="button" className={styles.reopen} onClick={() => setOpen(true)}>
        final scores
      </button>
    )
  }
  const winner = snap.players.find((p) => p.id === snap.winnerId)
  const ranked = [...snap.players].sort((a, b) => b.score - a.score)
  if (saving) {
    return (
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="game-over-title">
        <SaveCards snap={snap} onBack={() => setSaving(false)} />
      </div>
    )
  }
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="game-over-title">
      <div className={styles.overlayCard}>
        <h2 id="game-over-title" className={styles.overlayTitle}>
          {winner ? (winner.id === snap.youId ? "You win!" : `${winner.name} wins!`) : "Nobody wins."}
        </h2>
        {!winner && <p>No playable hands remain.</p>}
        <ol className={styles.final}>
          {ranked.map((p) => (
            <li key={p.id} className={p.id === snap.winnerId ? styles.winner : undefined}>
              <span>{p.name}</span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
        {snap.gameCards.length > 0 && (
          <button type="button" className="primary" onClick={() => setSaving(true)}>save cards you liked</button>
        )}
        <div className={styles.overlayActions}>
          <button type="button" onClick={() => setOpen(false)}>see the thread</button>
          <Link href="/" className={styles.bigLink}>new game</Link>
        </div>
      </div>
    </div>
  )
}
