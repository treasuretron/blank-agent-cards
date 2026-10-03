"use client"

import type { RoomSnapshot } from "@cards/shared"
import { useEffect, useState } from "react"
import { generateLimit } from "@/lib/generate"
import { useRoom } from "@/lib/room"
import styles from "./cards.module.css"

// "Let the agent draw some": asks the agent to write cards. While authoring they
// fill your quota; during play they're shuffled into the deck, which also
// restarts a game that ran out of cards.
export function GenerateCards({ snap, label }: { snap: RoomSnapshot; label?: string }) {
  const room = useRoom()
  const { max, blocked } = generateLimit(snap)
  const [count, setCount] = useState(1)
  useEffect(() => {
    if (max > 0 && count > max) setCount(max)
  }, [max, count])

  const pending = snap.generating
  const who = pending && (pending.playerId === snap.youId ? "you" : snap.players.find((p) => p.id === pending.playerId)?.name ?? "someone")
  const n = Math.max(1, Math.min(count, max))
  return (
    <div className={styles.generate}>
      <div className={styles.generateRow}>
        <span>{label ?? "let the agent draw"}</span>
        <button type="button" aria-label="fewer" disabled={!max || n <= 1} onClick={() => setCount(n - 1)}>−</button>
        <output aria-live="polite" className={styles.count}>{max ? n : 0}</output>
        <button type="button" aria-label="more" disabled={!max || n >= max} onClick={() => setCount(n + 1)}>+</button>
        <button
          type="button"
          className="primary"
          disabled={!max || room.status !== "open"}
          onClick={() => {
            room.clearError()
            room.send({ type: "generateCards", count: n })
          }}
        >
          {n === 1 ? "draw 1 card" : `draw ${n} cards`}
        </button>
      </div>
      <p className={styles.generateNote} role="status">
        {pending
          ? `The agent is drawing ${pending.count} card${pending.count === 1 ? "" : "s"} for ${who}…`
          : blocked ?? (snap.phase === "authoring" ? "It looks at your cards and some classics, then makes its own. They count toward your quota." : "New cards are shuffled into the deck. Anyone with an empty hand draws back up.")}
      </p>
    </div>
  )
}
