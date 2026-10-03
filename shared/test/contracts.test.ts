import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { AgentVerdictSchema, ClientMsgSchema, ConfigOverridesSchema, GameConfigSchema, RulesSchema, baseRules, cardDraftSchema, cardFace } from "../src/index.ts"

const config = JSON.parse(readFileSync(new URL("../../game.config.json", import.meta.url), "utf8"))

test("checked-in configuration and base rules validate", () => {
  const parsed = GameConfigSchema.parse(config)
  RulesSchema.parse(baseRules(parsed.targetScore, parsed.handSize))
})

test("configuration rejects impossible rooms and deals", () => {
  assert.equal(GameConfigSchema.safeParse({ ...config, minPlayers: config.maxPlayers + 1 }).success, false)
  assert.equal(GameConfigSchema.safeParse({ ...config, handSize: config.cardsPerPlayer + 1 }).success, false)
  assert.equal(GameConfigSchema.safeParse({ ...config, server: { port: 65536 } }).success, false)
  const overrides = ConfigOverridesSchema.parse({ handSize: config.cardsPerPlayer + 1 })
  assert.equal(GameConfigSchema.safeParse({ ...config, ...overrides }).success, false)
})

test("card text limits use the room configuration", () => {
  const schema = cardDraftSchema(config.card)
  const draft = { art: "data:image/png;base64,AA==", text: "x".repeat(config.card.maxChars) }
  assert.equal(schema.safeParse(draft).success, true)
  assert.equal(schema.safeParse({ ...draft, text: draft.text + "x" }).success, false)
  assert.equal(schema.safeParse({ ...draft, title: "x".repeat(config.card.titleMaxChars + 1) }).success, false)
})

test("protocol validates names, room codes, and reconnect credentials", () => {
  assert.deepEqual(ClientMsgSchema.parse({ type: "joinRoom", code: "ABCD", name: " Trav " }), { type: "joinRoom", code: "ABCD", name: "Trav" })
  for (const message of [
    { type: "createRoom", name: "   " },
    { type: "joinRoom", code: "", name: "Trav" },
    { type: "resume", code: "ABCD", token: "" },
    { type: "unknown" },
  ]) assert.equal(ClientMsgSchema.safeParse(message).success, false)
})

test("verdict defaults and extensible effects support future mechanics", () => {
  assert.deepEqual(AgentVerdictSchema.parse({ narration: "Nothing happens." }), { narration: "Nothing happens.", effects: [], rulesPatch: {} })
  const verdict = AgentVerdictSchema.parse({ narration: "Gravity changes.", effects: [{ kind: "gravity", value: "up" }], rulesPatch: { gravity: "up" } })
  assert.equal(verdict.effects[0].value, "up")
  assert.equal(RulesSchema.parse({ ...baseRules(100, 3), gravity: "up" }).gravity, "up")
})

test("engine card faces exclude PNG data", () => {
  assert.deepEqual(cardFace({ id: "c1", authorId: "p1", text: "Gain points", png: "private image" }), { id: "c1", authorId: "p1", text: "Gain points" })
})
