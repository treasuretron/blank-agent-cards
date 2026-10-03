"use client"

import type { RoomSnapshot } from "@cards/shared"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { RoomThread } from "@/components/chat/RoomThread"
import { GameOver } from "@/components/game/GameOver"
import { Hand } from "@/components/game/Hand"
import { RulesPanel } from "@/components/game/RulesPanel"
import { Scoreboard } from "@/components/game/Scoreboard"
import { RoomCode, RoomGate } from "@/components/room/RoomGate"
import { normalizeCode, useRoom } from "@/lib/room"
import { nameOf } from "@/lib/thread"
import styles from "./play.module.css"

export default function PlayPage() {
  const params = useParams<{ code: string }>()
  const code = normalizeCode(params.code ?? "")
  return <RoomGate code={code}>{(snap) => <Table snap={snap} />}</RoomGate>
}

function Table({ snap }: { snap: RoomSnapshot }) {
  const room = useRoom()
  const router = useRouter()
  const aspect = `${snap.config.card.widthPx} / ${snap.config.card.heightPx}`

  // Nothing to do at the table until the deck is dealt.
  useEffect(() => {
    if (snap.phase === "authoring") router.replace(`/room/${snap.code}/studio`)
  }, [snap.phase, snap.code, router])
  if (snap.phase === "authoring") return null

  const myTurn = snap.phase === "play" && snap.turn?.playerId === snap.youId
  const canPlay = myTurn && !snap.agentPending && room.status === "open"
  const turnName = nameOf(snap, snap.turn?.playerId)

  let banner: string
  if (snap.phase === "ended") banner = snap.winnerId ? `${nameOf(snap, snap.winnerId)} won the game.` : "Game over. No playable hands remain."
  else if (snap.agentPending) banner = "The agent is interpreting the card…"
  else if (myTurn) banner = "Your turn. Pick a card and play it."
  else banner = `Waiting for ${turnName} to play.`

  return (
    <main className={styles.table}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Link href="/">1000 Blank Agent Cards</Link>
        </h1>
        <RoomCode code={snap.code} path="play" />
        {room.status !== "open" && <span className={styles.status}>reconnecting…</span>}
        <p className={`${styles.banner} ${myTurn && !snap.agentPending ? styles.yourTurn : ""}`} role="status" aria-live="polite">
          {banner}
        </p>
      </header>

      {room.error && (
        <div className={`banner-error ${styles.error}`} role="alert">
          <span>{room.error}</span>
          <button type="button" onClick={room.clearError}>ok</button>
        </div>
      )}

      <aside className={styles.side}>
        <Scoreboard snap={snap} />
        <RulesPanel snap={snap} />
      </aside>

      <section className={styles.chat} aria-label="Room thread">
        <RoomThread snap={snap} aspect={aspect} />
      </section>

      <section className={styles.handArea} aria-label="Your hand">
        <h2 className={styles.handTitle}>
          Your hand <span className={styles.sub}>{snap.hand.length} cards</span>
        </h2>
        <Hand
          cards={snap.hand}
          aspect={aspect}
          canPlay={canPlay}
          onPlay={(cardId) => {
            room.clearError()
            room.send({ type: "playCard", cardId })
          }}
        />
      </section>

      {snap.phase === "ended" && <GameOver snap={snap} />}
    </main>
  )
}
