import { z } from "zod"

// Known keys the base engine reads. Cards may add any other key; the agent is
// expected to teach engine.mjs about new keys when it adds them.
export const RulesSchema = z
  .object({
    targetScore: z.number(),
    direction: z.union([z.literal(1), z.literal(-1)]),
    cardsPerTurn: z.number().int().min(1),
    drawAfterPlay: z.number().int().min(0),
    handSize: z.number().int().min(0),
    notes: z.array(z.string()),
  })
  .passthrough()
export type Rules = z.infer<typeof RulesSchema>

export function baseRules(targetScore: number, handSize: number): Rules {
  return {
    targetScore,
    direction: 1,
    cardsPerTurn: 1,
    drawAfterPlay: 1,
    handSize,
    notes: [
      "Players are playing for points. First player to reach targetScore wins.",
      "Turns rotate through all players one at a time; each plays one card per turn.",
    ],
  }
}

// Immediate, one-off consequences of a card. Interpreted by engine.mjs, so the
// agent can invent new kinds as long as it also patches the engine to handle them.
export const EffectSchema = z
  .object({
    kind: z.string(),
    target: z.string().optional(),
    amount: z.number().optional(),
  })
  .passthrough()
export type Effect = z.infer<typeof EffectSchema>

export const AgentVerdictSchema = z.object({
  narration: z.string().min(1),
  effects: z.array(EffectSchema).default([]),
  rulesPatch: z.record(z.string(), z.unknown()).default({}),
  enginePatch: z.string().optional(),
})
export type AgentVerdict = z.infer<typeof AgentVerdictSchema>
