"use client"

import { artSize as artSizeFor } from "@/lib/bitmap"
import { normalizeCode, useRoom } from "@/lib/room"
import { cardDraftSchema, type RoomSnapshot } from "@cards/shared"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { CardPreview } from "@/components/cards/CardPreview"
import { CardTile, EmptySlot } from "@/components/cards/CardTile"
import { ArtBoard, type ArtBoardHandle } from "@/components/studio/ArtBoard"
import { CappedField } from "@/components/studio/CappedField"
import { ImportCards } from "@/components/studio/ImportCards"
import { RoomCode, RoomGate } from "@/components/room/RoomGate"
import styles from "./studio.module.css"

export default function StudioPage() {
  const params = useParams<{ code: string }>()
  const code = normalizeCode(params.code ?? "")
  return <RoomGate code={code}>{(snap) => <Studio snap={snap} />}</RoomGate>
}

const SUBMIT_TIMEOUT_MS = 15_000

function Studio({ snap }: { snap: RoomSnapshot }) {
  const room = useRoom()
  const { config } = snap
  const art = artSizeFor(config.card)
  const aspect = `${config.card.widthPx} / ${config.card.heightPx}`
  const quota = config.cardsPerPlayer
  const authoring = snap.phase === "authoring"
  const me = snap.players.find((p) => p.id === snap.youId)
  const mine = snap.myCards
  const quotaFull = mine.length >= quota

  const board = useRef<ArtBoardHandle>(null)
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [artBlank, setArtBlank] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  // Count of my cards when the pending submit was sent; cleared once the
  // server's snapshot shows the new card, or on error/timeout.
  const [submittingFrom, setSubmittingFrom] = useState<number | null>(null)

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onArtChange = useCallback((blank: boolean) => {
    setArtBlank(blank)
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => setPreview(board.current?.exportPng() ?? null), 120)
  }, [])
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
  }, [])

  useEffect(() => {
    if (submittingFrom === null) return
    if (mine.length > submittingFrom) {
      setSubmittingFrom(null)
      setTitle("")
      setText("")
      board.current?.reset()
      return
    }
    if (room.error) {
      setSubmittingFrom(null)
      return
    }
    const t = setTimeout(() => {
      setSubmittingFrom(null)
      setLocalError("The server didn't confirm the card. Check your connection and try again.")
    }, SUBMIT_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [submittingFrom, mine.length, room.error])

  const empty = artBlank && !text.trim() && !title.trim()
  const submitting = submittingFrom !== null
  const canSubmit = authoring && !quotaFull && !empty && !submitting

  function submit() {
    if (!canSubmit || !board.current) return
    setLocalError(null)
    room.clearError()
    const draft = { title: title.trim() || undefined, text: text.trim(), art: board.current.exportPng() }
    const parsed = cardDraftSchema(config.card).safeParse(draft)
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "That card isn't valid.")
      return
    }
    setSubmittingFrom(mine.length)
    room.send({ type: "submitCard", card: parsed.data })
  }

  const everyoneDone = snap.players.every((p) => p.cardsSubmitted >= quota)
  const enoughPlayers = snap.players.length >= config.minPlayers
  const startBlocker = !enoughPlayers
    ? `Need at least ${config.minPlayers} players.`
    : !everyoneDone
      ? "Waiting for everyone to finish their cards."
      : null

  const error = localError ?? room.error

  // Follow the room to the table when the host deals.
  const router = useRouter()
  const wasAuthoring = useRef(authoring)
  useEffect(() => {
    if (wasAuthoring.current && !authoring) router.push(`/room/${snap.code}/play`)
    wasAuthoring.current = authoring
  }, [authoring, router, snap.code])

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Card studio</h1>
        <RoomCode code={snap.code} path="studio" />
        {room.status !== "open" && <span className={styles.status}>{room.status === "connecting" ? "connecting…" : "reconnecting…"}</span>}
      </header>

      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { setLocalError(null); room.clearError() }}>ok</button>
        </div>
      )}

      {!authoring && (
        <section className={styles.dealt}>
          <h2>{snap.phase === "ended" ? "Game over." : "The deck is dealt."}</h2>
          <p>Authoring is closed. Your hand:</p>
          <div className={styles.cardGrid}>
            {snap.hand.map((c) => <CardTile key={c.id} card={c} aspect={aspect} />)}
            {!snap.hand.length && <p>(empty)</p>}
          </div>
          <Link className={styles.bigLink} href={`/room/${snap.code}/play`}>Go to the table →</Link>
        </section>
      )}

      {authoring && (
        <div className={styles.columns}>
          <section className={styles.editor} aria-label="Card editor">
            <div className={styles.editorGrid}>
              <div className={styles.drawCol}>
                <ArtBoard ref={board} width={art.width} height={art.height} onChange={onArtChange} />
              </div>
              <div className={styles.sideCol}>
                <CappedField label="Title" value={title} max={config.card.titleMaxChars} onChange={setTitle} placeholder="optional" />
                <CappedField label="Card text" value={text} max={config.card.maxChars} onChange={setText} multiline placeholder="What does this card do?" />
                <CardPreview title={title.trim()} text={text.trim()} art={artBlank ? null : preview} aspect={aspect} />
                <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>
                  {submitting ? "adding…" : quotaFull ? "all cards submitted" : `add card ${mine.length + 1} of ${quota}`}
                </button>
              </div>
            </div>
          </section>

          <aside className={styles.side}>
            <section>
              <h2>
                Your cards <span className={styles.quota}>{mine.length}/{quota}</span>
              </h2>
              <div className={styles.cardGrid}>
                {mine.map((c) => (
                  <CardTile key={c.id} card={c} aspect={aspect}>
                    <button type="button" onClick={() => room.send({ type: "deleteCard", cardId: c.id })}>remove</button>
                  </CardTile>
                ))}
                {Array.from({ length: Math.max(0, quota - mine.length) }, (_, i) => (
                  <EmptySlot key={i} aspect={aspect} label={`#${mine.length + i + 1}`} />
                ))}
              </div>
            </section>

            <ImportCards snap={snap} />

            <section>
              <h2>Players</h2>
              <ul className={styles.players}>
                {snap.players.map((p) => (
                  <li key={p.id} className={p.connected ? undefined : styles.away}>
                    <span>
                      {p.name}
                      {p.id === snap.youId && " (you)"}
                      {p.isHost && <span className={styles.badge}>host</span>}
                    </span>
                    <span className={styles.progress} aria-label={`${p.cardsSubmitted} of ${quota} cards`}>
                      {Array.from({ length: quota }, (_, i) => (
                        <span key={i} className={i < p.cardsSubmitted ? styles.pipFull : styles.pip} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <div className={styles.mode} role="group" aria-label="Game mode">
                <span>mode</span>
                {(["fast", "learning"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={config.mode === mode}
                    disabled={!me?.isHost || config.mode === mode}
                    onClick={() => room.send({ type: "setMode", mode })}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className={styles.note}>
                {config.mode === "learning"
                  ? "Learning mode: the agent takes notes on every ruling and writes a report on how to play faster."
                  : "Fast mode: rulings only, no notes."}
              </p>
              {me?.isHost ? (
                <>
                  <button type="button" className="primary" disabled={!!startBlocker} onClick={() => room.send({ type: "startGame" })}>
                    deal the deck
                  </button>
                  {startBlocker && <p className={styles.note}>{startBlocker}</p>}
                </>
              ) : (
                <p className={styles.note}>{startBlocker ?? "Waiting for the host to deal."}</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </main>
  )
}
