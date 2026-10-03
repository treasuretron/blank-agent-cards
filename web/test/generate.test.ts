import assert from "node:assert/strict"
import { test } from "node:test"
import type { RoomSnapshot } from "@cards/shared"
import { generateLimit } from "../lib/generate.ts"

const config = { cardsPerPlayer: 4, generate: { maxPerRequest: 3, maxPerRoom: 40 } }
function snap(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return { phase: "authoring", config, myCards: [], generating: null, generateRemaining: 40, winnerId: null, ...over } as unknown as RoomSnapshot
}
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) })) as RoomSnapshot["myCards"]

test("authoring is capped by the request limit and what's left of your quota", () => {
  assert.deepEqual(generateLimit(snap()), { max: 3, blocked: null })
  assert.deepEqual(generateLimit(snap({ myCards: cards(3) })), { max: 1, blocked: null })
  assert.equal(generateLimit(snap({ myCards: cards(4) })).max, 0)
})

test("play ignores the quota but not the room's budget", () => {
  assert.equal(generateLimit(snap({ phase: "play", myCards: cards(4) })).max, 3)
  assert.equal(generateLimit(snap({ phase: "play", generateRemaining: 2 })).max, 2)
  assert.match(generateLimit(snap({ phase: "play", generateRemaining: 0 })).blocked!, /all the cards/)
})

test("blocked while the agent is drawing or after someone has won", () => {
  assert.equal(generateLimit(snap({ generating: { playerId: "b", count: 2 } })).max, 0)
  assert.equal(generateLimit(snap({ phase: "ended", winnerId: "a" })).max, 0)
  assert.equal(generateLimit(snap({ phase: "ended", winnerId: null })).max, 3)
})
