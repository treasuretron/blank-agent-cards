"use client"

import type { RoomSnapshot } from "@cards/shared"
import { useEffect, useState } from "react"
import { loadSeat, serverUrl } from "@/lib/room"
import { download } from "@/lib/savedCards"
import styles from "./game.module.css"

// The learning-mode report, shown as the raw Markdown the server wrote.
export function LearningReport({ snap, onBack }: { snap: RoomSnapshot; onBack(): void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = loadSeat(snap.code)?.token ?? ""
    let live = true
    fetch(`${serverUrl()}/rooms/${snap.code}/learning-report?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("The report isn't available."))))
      .then((body) => live && setText(body))
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [snap.code])

  return (
    <div className={`${styles.overlayCard} ${styles.wide}`}>
      <h2 id="game-over-title" className={styles.h2}>
        Learning report <span className={styles.sub}>{snap.learning?.notes ?? 0} plays noted</span>
      </h2>
      {error && <p role="alert">{error}</p>}
      {!error && text === null && <p className={styles.sub}>loading…</p>}
      {text !== null && <pre className={styles.report}>{text}</pre>}
      <div className={styles.overlayActions}>
        <button type="button" onClick={onBack}>back</button>
        <button
          type="button"
          disabled={text === null}
          onClick={() => text !== null && download(`learning-report-${snap.code}.md`, new TextEncoder().encode(text), "text/markdown")}
        >
          download .md
        </button>
      </div>
    </div>
  )
}
