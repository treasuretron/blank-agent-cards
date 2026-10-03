"use client"

import { useState } from "react"
import { useRoom } from "@/lib/room"
import styles from "./game.module.css"

// Ends the game for everyone: the top score wins and the game-over screen opens.
// Two clicks, so a stray one can't end the game.
export function EndGame({ busy }: { busy: boolean }) {
  const room = useRoom()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) return <button type="button" onClick={() => setConfirming(true)}>end game</button>
  return (
    <span className={styles.endGame} role="group" aria-label="Confirm ending the game">
      <span>{busy ? "end after this ruling?" : "end it for everyone?"}</span>
      <button
        type="button"
        className="primary"
        disabled={room.status !== "open"}
        onClick={() => {
          room.clearError()
          room.send({ type: "endGame" })
          setConfirming(false)
        }}
      >
        yes, end it
      </button>
      <button type="button" onClick={() => setConfirming(false)}>keep playing</button>
    </span>
  )
}
