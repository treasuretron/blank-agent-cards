"use client"

import type { RoomSnapshot } from "@cards/shared"
import styles from "./game.module.css"

export function Scoreboard({ snap }: { snap: RoomSnapshot }) {
  const target = snap.rules?.targetScore ?? snap.config.targetScore
  const direction = snap.rules?.direction ?? 1
  return (
    <section aria-label="Scores">
      <h2 className={styles.h2}>
        Scores <span className={styles.sub}>first to {target}</span>
      </h2>
      <ol className={styles.scores}>
        {snap.players.map((p) => {
          const turn = snap.turn?.playerId === p.id && snap.phase === "play"
          const winner = snap.winnerId === p.id
          const pct = target > 0 ? Math.max(0, Math.min(100, (p.score / target) * 100)) : 0
          return (
            <li
              key={p.id}
              className={`${styles.score} ${turn ? styles.turn : ""} ${winner ? styles.winner : ""} ${p.connected ? "" : styles.away}`}
              aria-current={turn ? "step" : undefined}
            >
              <span className={styles.marker} aria-hidden>{turn ? (direction === 1 ? "▶" : "◀") : winner ? "★" : ""}</span>
              <span className={styles.name}>
                {p.name}
                {p.id === snap.youId && <span className={styles.you}> (you)</span>}
                {!p.connected && <span className={styles.sub}> away</span>}
              </span>
              <span className={styles.points}>{p.score}</span>
              <span className={styles.bar} aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className={styles.handCount} title={`${p.handCount} cards in hand`}>
                {Array.from({ length: Math.min(p.handCount, 8) }, (_, i) => <span key={i} className={styles.miniCard} />)}
                {p.handCount > 8 && <span className={styles.sub}>+{p.handCount - 8}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <p className={styles.sub}>
        turn {snap.turn?.number ?? "–"} · {snap.deckCount} in deck · order {direction === 1 ? "clockwise" : "reversed"}
      </p>
    </section>
  )
}
