"use client"

import type { RoomSnapshot } from "@cards/shared"
import Link from "next/link"
import { useState } from "react"
import { GenerateCards } from "@/components/cards/GenerateCards"
import { LearningReport } from "./LearningReport"
import { SaveCards } from "./SaveCards"
import styles from "./game.module.css"

export function GameOver({ snap }: { snap: RoomSnapshot }) {
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<"scores" | "save" | "report">("scores")
  if (!open) {
    return (
      <button type="button" className={styles.reopen} onClick={() => setOpen(true)}>
        final scores
      </button>
    )
  }
  const winner = snap.players.find((p) => p.id === snap.winnerId)
  const ranked = [...snap.players].sort((a, b) => b.score - a.score)
  if (view !== "scores") {
    return (
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="game-over-title">
        {view === "save" ? <SaveCards snap={snap} onBack={() => setView("scores")} /> : <LearningReport snap={snap} onBack={() => setView("scores")} />}
      </div>
    )
  }
  const report = snap.learning?.report
  const endedBy = snap.endedBy && (snap.endedBy === snap.youId ? "You" : snap.players.find((p) => p.id === snap.endedBy)?.name)
  const top = ranked[0]?.score
  const tied = ranked.filter((p) => p.score === top)
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="game-over-title">
      <div className={styles.overlayCard}>
        <h2 id="game-over-title" className={styles.overlayTitle}>
          {winner ? (winner.id === snap.youId ? "You win!" : `${winner.name} wins!`) : endedBy && tied.length > 1 ? "It's a tie!" : "Nobody wins."}
        </h2>
        {endedBy ? <p>{endedBy} ended the game.{!winner && tied.length > 1 && ` ${tied.map((p) => p.name).join(" and ")} share the top score.`}</p> : !winner && <p>No playable hands remain.</p>}
        {!winner && !endedBy && <GenerateCards snap={snap} label="keep playing: the agent draws" />}
        <ol className={styles.final}>
          {ranked.map((p) => (
            <li key={p.id} className={p.id === snap.winnerId ? styles.winner : undefined}>
              <span>{p.name}</span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
        {snap.gameCards.length > 0 && (
          <button type="button" className="primary" onClick={() => setView("save")}>save cards you liked</button>
        )}
        {snap.learning && (
          <button type="button" disabled={report !== "ready"} onClick={() => setView("report")}>
            {report === "ready" ? "learning report" : report === "failed" ? "learning report failed" : "writing learning report…"}
          </button>
        )}
        <div className={styles.overlayActions}>
          <button type="button" onClick={() => setOpen(false)}>see the thread</button>
          <Link href="/" className={styles.bigLink}>new game</Link>
        </div>
      </div>
    </div>
  )
}
