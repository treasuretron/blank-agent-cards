"use client"

import type { RoomSnapshot } from "@cards/shared"
import { useEffect, useRef, useState } from "react"
import { CardTile } from "@/components/cards/CardTile"
import { useRoom } from "@/lib/room"
import { pngDataUrl, readSavedFiles, type SavedPair } from "@/lib/savedCards"
import styles from "@/app/room/[code]/studio/studio.module.css"

const MAX_PNG_BYTES = 2_000_000
const IMPORT_TIMEOUT_MS = 15_000

type Pending = { from: number; label: string } | null

// Brings saved cards (from the end-of-game picker) into this game. Imports count
// toward the quota and go one at a time: the server rate-limits queued messages.
export function ImportCards({ snap }: { snap: RoomSnapshot }) {
  const room = useRoom()
  const aspect = `${snap.config.card.widthPx} / ${snap.config.card.heightPx}`
  const mine = snap.myCards.length
  const remaining = Math.max(0, snap.config.cardsPerPlayer - mine)

  const [browsing, setBrowsing] = useState(false)
  const [queue, setQueue] = useState<SavedPair[]>([])
  const [pending, setPending] = useState<Pending>(null)
  const [report, setReport] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  // Settle the in-flight import once the server shows a new card or an error.
  useEffect(() => {
    if (!pending) return
    if (mine > pending.from) {
      setPending(null)
      return
    }
    if (room.error) {
      setReport((r) => [...r, `${pending.label}: ${room.error}`])
      room.clearError()
      setPending(null)
      return
    }
    const t = setTimeout(() => {
      setReport((r) => [...r, `${pending.label}: the server didn't confirm the import.`])
      setPending(null)
    }, IMPORT_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pending, mine, room])

  // Feed the local queue to the server one pair at a time.
  useEffect(() => {
    if (pending || !queue.length || room.status !== "open") return
    const [next, ...rest] = queue
    setQueue(rest)
    if (remaining <= 0) {
      setReport((r) => [...r, `${rest.length + 1} more skipped: your card quota is full.`])
      setQueue([])
      return
    }
    setPending({ from: mine, label: next.name })
    room.send({ type: "importCard", png: pngDataUrl(next.png), meta: next.meta })
  }, [pending, queue, remaining, mine, room])

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return
    const { pairs, errors } = await readSavedFiles([...files])
    const tooBig = pairs.filter((p) => p.png.length > MAX_PNG_BYTES)
    setReport([...errors, ...tooBig.map((p) => `${p.name}.png is too large to import`)])
    setQueue((q) => [...q, ...pairs.filter((p) => p.png.length <= MAX_PNG_BYTES)])
    if (fileInput.current) fileInput.current.value = ""
  }

  function openLibrary() {
    setBrowsing((b) => !b)
    if (!browsing) room.send({ type: "listLibrary" })
  }

  function importFromLibrary(name: string) {
    setReport([])
    room.clearError()
    setPending({ from: mine, label: name })
    room.send({ type: "importLibraryCard", name })
  }

  const busy = !!pending || queue.length > 0
  return (
    <section>
      <h2>Import saved cards</h2>
      <p className={styles.note}>Saved cards from earlier games count toward your {snap.config.cardsPerPlayer}.</p>
      <div className={styles.importActions}>
        <button type="button" aria-pressed={browsing} onClick={openLibrary}>from the server</button>
        <button type="button" disabled={!remaining || busy} onClick={() => fileInput.current?.click()}>from your computer</button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".png,.json,.zip,image/png,application/json,application/zip"
          onChange={(e) => void pickFiles(e.target.files)}
        />
      </div>
      {busy && <p className={styles.note} role="status">importing…</p>}
      {report.length > 0 && (
        <ul className={styles.importReport} role="alert">
          {report.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {browsing && (
        <div className={styles.cardGrid}>
          {room.library === null && <p className={styles.note}>loading…</p>}
          {room.library?.length === 0 && <p className={styles.note}>No saved cards on this server yet.</p>}
          {room.library?.map((card) => (
            <CardTile key={card.name} card={card} aspect={aspect}>
              <span className={styles.note}>by {card.authorName}</span>
              <button type="button" disabled={!remaining || busy} onClick={() => importFromLibrary(card.name)}>add</button>
            </CardTile>
          ))}
        </div>
      )}
    </section>
  )
}
