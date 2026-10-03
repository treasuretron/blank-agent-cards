import type { CardView, Effect, RoomSnapshot, ThreadEntry } from "@cards/shared"

// Maps the server's room thread onto assistant-ui messages. Humans (chat and
// card plays) are "user" messages tagged with their author; the agent's
// verdicts are "assistant" messages. Cards and verdicts travel as data parts
// so the thread renders them as components, not text.

export type CardPartData = { card: CardView; authorName: string }
export type VerdictPartData = {
  cardId: string
  cardTitle?: string
  effects: string[]
  rulesChanged: { key: string; value: string }[]
  engineChanged: boolean
  engineError?: string
  events: string[]
  failed: boolean
}
export type PendingPartData = { authorName: string; cardTitle?: string }

export type RoomMessageCustom = { authorId?: string; authorName?: string; mine?: boolean; kind: ThreadEntry["kind"] | "pending" }

type DataPart = { type: "data"; name: string; data: unknown }
type TextPart = { type: "text"; text: string }

export type RoomMessage = {
  id: string
  role: "user" | "assistant" | "system"
  createdAt: Date
  content: readonly (TextPart | DataPart)[]
  status?: { type: "running" } | { type: "complete"; reason: "stop" }
  metadata: { custom: RoomMessageCustom }
}

export function nameOf(snap: Pick<RoomSnapshot, "players">, id: string | undefined): string {
  if (!id) return "someone"
  return snap.players.find((p) => p.id === id)?.name ?? "someone"
}

function fmtValue(v: unknown): string {
  if (typeof v === "string") return v
  const s = JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 77)}…` : s
}

// Human summary of one effect. Player ids are replaced with names; unknown
// effect kinds still show their kind and fields.
export function describeEffect(effect: Effect, snap: Pick<RoomSnapshot, "players">): string {
  const { kind, target, amount, ...rest } = effect
  const who = target ? ` → ${nameOf(snap, target)}` : ""
  switch (kind) {
    case "score":
      return `${amount !== undefined && amount >= 0 ? "+" : ""}${amount ?? 0} points${who}`
    case "draw":
      return `draw ${amount ?? 1}${who}`
    case "reverse":
      return "turn order reversed"
    case "skip":
      return `skip ${amount ?? 1}${who}`
    default: {
      const extras = Object.entries(rest).map(([k, v]) => `${k}: ${fmtValue(v)}`)
      return [kind + (amount !== undefined ? ` ${amount}` : "") + who, ...extras].join(", ")
    }
  }
}

export function toMessages(snap: RoomSnapshot): RoomMessage[] {
  const cardsById = new Map<string, CardView>()
  const out: RoomMessage[] = []
  for (const entry of snap.thread) {
    const createdAt = new Date(entry.at)
    if (entry.kind === "system") {
      out.push({ id: entry.id, role: "system", createdAt, content: [{ type: "text", text: entry.text }], metadata: { custom: { kind: "system" } } })
    } else if (entry.kind === "chat") {
      out.push({
        id: entry.id,
        role: "user",
        createdAt,
        content: [{ type: "text", text: entry.text }],
        metadata: { custom: { kind: "chat", authorId: entry.authorId, authorName: nameOf(snap, entry.authorId), mine: entry.authorId === snap.youId } },
      })
    } else if (entry.kind === "play") {
      cardsById.set(entry.card.id, entry.card)
      const authorName = nameOf(snap, entry.authorId)
      out.push({
        id: entry.id,
        role: "user",
        createdAt,
        content: [{ type: "data", name: "card", data: { card: entry.card, authorName } satisfies CardPartData }],
        metadata: { custom: { kind: "play", authorId: entry.authorId, authorName, mine: entry.authorId === snap.youId } },
      })
    } else {
      const failed = entry.engineError !== undefined
      const v = entry.verdict
      const data: VerdictPartData = {
        cardId: entry.cardId,
        cardTitle: cardsById.get(entry.cardId)?.title,
        // A failed interpretation applied nothing; never present its proposals as effects.
        effects: failed ? [] : v.effects.map((e) => describeEffect(e, snap)),
        rulesChanged: failed ? [] : Object.entries(v.rulesPatch).map(([key, value]) => ({ key, value: fmtValue(value) })),
        engineChanged: !failed && entry.engineChanged,
        engineError: entry.engineError,
        events: entry.events,
        failed,
      }
      out.push({
        id: entry.id,
        role: "assistant",
        createdAt,
        content: [
          { type: "text", text: v.narration },
          { type: "data", name: "verdict", data },
        ],
        status: { type: "complete", reason: "stop" },
        metadata: { custom: { kind: "verdict" } },
      })
    }
  }

  if (snap.agentPending) {
    // The pending card is the most recent play without a verdict.
    const answered = new Set(snap.thread.flatMap((e) => (e.kind === "verdict" ? [e.cardId] : [])))
    const play = [...snap.thread].reverse().find((e) => e.kind === "play" && !answered.has(e.card.id))
    const data: PendingPartData = {
      authorName: play?.kind === "play" ? nameOf(snap, play.authorId) : "someone",
      cardTitle: play?.kind === "play" ? play.card.title : undefined,
    }
    out.push({
      id: `pending:${play?.id ?? "?"}`,
      role: "assistant",
      createdAt: new Date(play?.at ?? 0),
      content: [{ type: "data", name: "pending", data }],
      status: { type: "running" },
      metadata: { custom: { kind: "pending" } },
    })
  }
  return out
}
