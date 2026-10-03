"use client"

import { savedCardName, type CardView, type RoomSnapshot } from "@cards/shared"
import { useEffect, useState } from "react"
import { CardTile } from "@/components/cards/CardTile"
import { useRoom } from "@/lib/room"
import { bundle, download, savedCardEntries, savedCardMeta } from "@/lib/savedCards"
import styles from "./game.module.css"

// End-of-game grid: every card from the game, click to pick the ones worth
// keeping, then download them or put them in the server library.
export function SaveCards({ snap, onBack }: { snap: RoomSnapshot; onBack(): void }) {
  const room = useRoom()
  const aspect = `${snap.config.card.widthPx} / ${snap.config.card.heightPx}`
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<"download" | "server" | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [savedBefore, setSavedBefore] = useState(room.savedNames)

  const chosen = snap.gameCards.filter((c) => picked.has(c.id))
  const authorName = (card: CardView) => snap.players.find((p) => p.id === card.authorId)?.name ?? "unknown"

  // The server answers saveCards with the names it wrote.
  useEffect(() => {
    if (busy !== "server" || room.savedNames === savedBefore) return
    setBusy(null)
    setStatus(`Saved ${room.savedNames?.length ?? 0} card${room.savedNames?.length === 1 ? "" : "s"} to the server library.`)
  }, [busy, room.savedNames, savedBefore])
  useEffect(() => {
    if (busy === "server" && room.error) setBusy(null)
  }, [busy, room.error])

  function toggle(id: string) {
    setStatus(null)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function saveLocal() {
    setBusy("download")
    setStatus(null)
    try {
      const entries = []
      for (const card of chosen) {
        const res = await fetch(room.imageUrl(card))
        if (!res.ok) throw new Error(`Couldn't fetch "${card.title ?? card.text}"`)
        entries.push(...savedCardEntries(card, savedCardMeta(card, authorName(card), snap.code), new Uint8Array(await res.arrayBuffer())))
      }
      if (chosen.length === 1) {
        for (const entry of entries) download(entry.name, entry.data, entry.name.endsWith(".png") ? "image/png" : "application/json")
      } else {
        download(`cards-${snap.code}.zip`, bundle(entries), "application/zip")
      }
      setStatus(`Downloaded ${chosen.length} card${chosen.length === 1 ? "" : "s"}.`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Download failed.")
    } finally {
      setBusy(null)
    }
  }

  function saveServer() {
    room.clearError()
    setStatus(null)
    setSavedBefore(room.savedNames)
    setBusy("server")
    room.send({ type: "saveCards", cardIds: chosen.map((c) => c.id) })
  }

  return (
    <div className={`${styles.overlayCard} ${styles.wide}`}>
      <h2 id="game-over-title" className={styles.h2}>
        Save cards you liked <span className={styles.sub}>{picked.size} of {snap.gameCards.length} picked</span>
      </h2>
      <p className={styles.sub}>
        Click cards to pick them. Each one saves as a matching <code>.png</code> and <code>.json</code>, ready to import into
        a new game.
      </p>
      <div className={styles.saveGrid}>
        {snap.gameCards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`${styles.cardButton} ${picked.has(card.id) ? styles.picked : ""}`}
            aria-pressed={picked.has(card.id)}
            title={savedCardName(card)}
            onClick={() => toggle(card.id)}
          >
            <CardTile card={card} aspect={aspect}>
              <span className={styles.sub}>
                {picked.has(card.id) ? "✓ " : ""}by {authorName(card)}
              </span>
            </CardTile>
          </button>
        ))}
      </div>
      {(status ?? room.error) && <p role="status">{status ?? room.error}</p>}
      <div className={styles.overlayActions}>
        <button type="button" onClick={onBack}>back</button>
        <span className={styles.saveActions}>
          <button type="button" onClick={() => setPicked(picked.size === snap.gameCards.length ? new Set() : new Set(snap.gameCards.map((c) => c.id)))}>
            {picked.size === snap.gameCards.length ? "clear" : "pick all"}
          </button>
          <button type="button" disabled={!chosen.length || !!busy} onClick={saveLocal}>
            {busy === "download" ? "downloading…" : "download"}
          </button>
          <button type="button" className="primary" disabled={!chosen.length || !!busy || room.status !== "open"} onClick={saveServer}>
            {busy === "server" ? "saving…" : "save to server"}
          </button>
        </span>
      </div>
    </div>
  )
}
