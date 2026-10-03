"use client"

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type DataMessagePartComponent,
  type TextMessagePartComponent,
} from "@assistant-ui/react"
import type { RoomSnapshot } from "@cards/shared"
import { useEffect, useMemo, useState } from "react"
import { CardTile } from "@/components/cards/CardTile"
import { CardZoom } from "@/components/cards/CardZoom"
import cardStyles from "@/components/cards/cards.module.css"
import { useRoom } from "@/lib/room"
import { toMessages, type CardPartData, type PendingPartData, type RoomMessage, type RoomMessageCustom, type VerdictPartData } from "@/lib/thread"
import styles from "./chat.module.css"

const SAY_MAX = 500

// One shared thread per room: everyone's chat, every card play, and every
// agent verdict, driven entirely by server snapshots.
export function RoomThread({ snap, aspect }: { snap: RoomSnapshot; aspect: string }) {
  const room = useRoom()
  const messages = useMemo(() => toMessages(snap), [snap])

  const runtime = useExternalStoreRuntime<RoomMessage>({
    messages,
    convertMessage: (m) => m,
    // Players keep chatting while the agent works, so the thread itself is
    // never "running"; the pending message carries that beat instead.
    isRunning: false,
    isDisabled: room.status !== "open",
    onNew: async (msg: AppendMessage) => {
      const text = msg.content
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n")
        .trim()
      if (text) room.send({ type: "say", text: text.slice(0, SAY_MAX) })
    },
  })

  const parts = useMemo(
    () => ({
      Text: NarrationText,
      data: {
        by_name: {
          card: ((p) => <PlayedCard {...(p.data as CardPartData)} aspect={aspect} />) as DataMessagePartComponent,
          verdict: VerdictDetails,
          pending: Interpreting,
        },
      },
    }),
    [aspect],
  )

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className={styles.thread}>
        <ThreadPrimitive.Viewport className={styles.viewport}>
          <ThreadPrimitive.Empty>
            <p className={styles.empty}>The table is quiet. Play a card, or say something.</p>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const custom = (message.metadata.custom ?? {}) as RoomMessageCustom
              const cls =
                message.role === "system"
                  ? styles.system
                  : message.role === "assistant"
                    ? styles.agent
                    : `${styles.human} ${custom.mine ? styles.mine : ""} ${custom.kind === "play" ? styles.play : ""}`
              return (
                <MessagePrimitive.Root className={cls}>
                  {message.role === "assistant" && <div className={styles.author}>the agent</div>}
                  {message.role === "user" && (
                    <div className={styles.author}>
                      {custom.mine ? "you" : custom.authorName}
                      {custom.kind === "play" && " played"}
                    </div>
                  )}
                  <MessagePrimitive.Parts components={parts} />
                </MessagePrimitive.Root>
              )
            }}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className={styles.composer}>
          <ComposerPrimitive.Input
            className={styles.input}
            placeholder={room.status === "open" ? "Say something to the table…" : "Reconnecting…"}
            maxLength={SAY_MAX}
            rows={1}
            aria-label="Message the room"
          />
          <ComposerPrimitive.Send className={styles.send}>send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

const NarrationText: TextMessagePartComponent = ({ text }) => <p className={styles.text}>{text}</p>

function PlayedCard({ card, aspect }: CardPartData & { aspect: string }) {
  const [zoom, setZoom] = useState(false)
  return (
    <div className={styles.reveal}>
      <button
        type="button"
        className={cardStyles.zoomTrigger}
        onClick={() => setZoom(true)}
        aria-label={`${card.title ?? "Untitled"}: ${card.text} — enlarge`}
      >
        <CardTile card={card} aspect={aspect} size="large" />
      </button>
      {zoom && <CardZoom card={card} aspect={aspect} onClose={() => setZoom(false)} />}
    </div>
  )
}

const VerdictDetails: DataMessagePartComponent = ({ data }) => {
  const v = data as VerdictPartData
  if (v.failed) {
    return (
      <div className={`${styles.verdict} ${styles.fizzled}`}>
        <strong>The card fizzled.</strong> Nothing happened, and the turn moved on.
        {v.engineError && (
          <details>
            <summary>why</summary>
            <pre className={styles.error}>{v.engineError}</pre>
          </details>
        )}
      </div>
    )
  }
  const nothing = !v.effects.length && !v.rulesChanged.length && !v.engineChanged && !v.events.length
  if (nothing) return null
  return (
    <div className={styles.verdict}>
      {v.effects.length > 0 && (
        <ul className={styles.chips} aria-label="Effects">
          {v.effects.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {v.rulesChanged.length > 0 && (
        <div className={styles.rules}>
          <span className={styles.label}>rules changed</span>
          <ul>
            {v.rulesChanged.map((r) => (
              <li key={r.key}>
                <code>{r.key}</code> = {r.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.engineChanged && <div className={styles.engine}>engine rewritten: the agent changed how the game works</div>}
      {v.events.length > 0 && (
        <ul className={styles.events} aria-label="What happened">
          {v.events.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

const QUIPS = ["reading the card", "squinting at the drawing", "consulting the rules", "thinking about it", "deciding your fate"]

// The referee is a free model on a shared provider, so a turn can run long.
// Say so as it happens instead of leaving one frozen line on screen.
function useElapsed(since?: number) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (since === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return since === undefined || now === null ? null : Math.max(0, Math.round((now - since) / 1000))
}

function phase(elapsed: number, timeoutMs: number | undefined) {
  const limit = (timeoutMs ?? 90000) / 1000
  if (elapsed >= limit * 0.95) return `Nearly out of time — ${elapsed}s`
  if (elapsed >= limit * 0.75) return `Still going at ${elapsed}s…`
  if (elapsed >= limit * 0.4) return `Taking a while — ${elapsed}s so far`
  return null
}

const Interpreting: DataMessagePartComponent = ({ data }) => {
  const p = data as PendingPartData
  const elapsed = useElapsed(p.since)
  const note = elapsed === null ? null : phase(elapsed, p.timeoutMs)
  return (
    <div className={styles.pending} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden />
      <span>
        {p.cardTitle ? <>“{p.cardTitle}” from {p.authorName}</> : <>{p.authorName}’s card</>}…{" "}
        <span className={styles.quips} aria-hidden>
          {QUIPS.map((q) => <span key={q}>{q}</span>)}
        </span>
        {note && <span className={styles.waiting}> {note}</span>}
      </span>
    </div>
  )
}
