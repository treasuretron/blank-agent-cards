import assert from "node:assert/strict"
import { test } from "node:test"
import type { RoomSnapshot, ThreadEntry } from "@cards/shared"
import { describeEffect, toMessages, type PendingPartData, type VerdictPartData } from "../lib/thread.ts"

const players = [
  { id: "a", name: "Trav", score: 0, handCount: 3, cardsSubmitted: 4, connected: true, isHost: true },
  { id: "b", name: "Lucas", score: 0, handCount: 3, cardsSubmitted: 4, connected: true, isHost: false },
]

function snap(thread: ThreadEntry[], agentPending = false, extra: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return { code: "ABCD", phase: "play", youId: "a", players, thread, agentPending, agentTimeoutMs: 90000, ...extra } as unknown as RoomSnapshot
}

const card = { id: "c1", authorId: "b", title: "Thief", text: "steal 5", imageUrl: "/x" }

test("chat, plays and verdicts map to user/assistant messages with authors", () => {
  const msgs = toMessages(
    snap([
      { id: "1", at: 1, kind: "system", text: "Game on" },
      { id: "2", at: 2, kind: "chat", authorId: "b", text: "hi" },
      { id: "3", at: 3, kind: "play", authorId: "a", card },
      {
        id: "4",
        at: 4,
        kind: "verdict",
        cardId: "c1",
        verdict: { narration: "Trav steals.", effects: [{ kind: "score", amount: 5, target: "a" }], rulesPatch: { targetScore: 50 } },
        engineChanged: true,
        events: ["Trav +5"],
      },
    ]),
  )
  assert.deepEqual(msgs.map((m) => m.role), ["system", "user", "user", "assistant"])
  assert.deepEqual(msgs[1].metadata.custom, { kind: "chat", authorId: "b", authorName: "Lucas", mine: false })
  assert.equal(msgs[2].metadata.custom.mine, true)
  assert.deepEqual(msgs[2].content[0], { type: "data", name: "card", data: { card, authorName: "Trav" } })
  const verdict = msgs[3].content[1] as { data: VerdictPartData }
  assert.deepEqual(msgs[3].content[0], { type: "text", text: "Trav steals." })
  assert.deepEqual(verdict.data.effects, ["+5 points → Trav"])
  assert.deepEqual(verdict.data.rulesChanged, [{ key: "targetScore", value: "50" }])
  assert.equal(verdict.data.cardTitle, "Thief")
  assert.equal(verdict.data.engineChanged, true)
})

test("failed interpretations never show proposed effects or engine changes", () => {
  const [, msg] = toMessages(
    snap([
      { id: "3", at: 3, kind: "play", authorId: "a", card },
      {
        id: "4",
        at: 4,
        kind: "verdict",
        cardId: "c1",
        verdict: { narration: "Interpretation failed.", effects: [{ kind: "score", amount: 99 }], rulesPatch: { x: 1 } },
        engineChanged: true,
        engineError: "SyntaxError",
        events: [],
      },
    ]),
  )
  const data = (msg.content[1] as { data: VerdictPartData }).data
  assert.equal(data.failed, true)
  assert.deepEqual(data.effects, [])
  assert.deepEqual(data.rulesChanged, [])
  assert.equal(data.engineChanged, false)
  assert.equal(data.engineError, "SyntaxError")
})

test("a pending play adds a running agent message for the unanswered card", () => {
  const msgs = toMessages(snap([{ id: "3", at: 3, kind: "play", authorId: "b", card }], true))
  const last = msgs.at(-1)!
  assert.equal(last.role, "assistant")
  assert.deepEqual(last.status, { type: "running" })
  // `since` and `timeoutMs` drive the elapsed-time status in the thread.
  assert.deepEqual(last.content[0], {
    type: "data",
    name: "pending",
    data: { authorName: "Lucas", cardTitle: "Thief", since: 3, timeoutMs: 90000 },
  })
  assert.equal(toMessages(snap([], false)).length, 0)
})

test("the server's pending start time wins over the play timestamp", () => {
  const play: ThreadEntry = { id: "3", at: 3, kind: "play", authorId: "b", card }
  const data = (toMessages(snap([play], true, { agentPendingSince: 5000 })).at(-1)!.content[0] as { data: PendingPartData }).data
  assert.equal(data.since, 5000)
  assert.equal(data.timeoutMs, 90000)
})

test("effects are described with names, unknown kinds keep their fields", () => {
  const s = { players }
  assert.equal(describeEffect({ kind: "score", amount: -10, target: "b" }, s), "-10 points → Lucas")
  assert.equal(describeEffect({ kind: "reverse" }, s), "turn order reversed")
  assert.equal(describeEffect({ kind: "swapHands", target: "b", with: "a" }, s), "swapHands → Lucas, with: a")
})
