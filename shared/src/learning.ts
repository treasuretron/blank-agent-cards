import { z } from "zod"
import type { CardFace } from "./card.ts"
import type { AgentVerdict, Rules } from "./rules.ts"

// Learning mode (M7). After each ruling the server records what happened and how
// long it took; the agent adds its own reflection. Notes are one JSON line per
// play in <rooms>/learning/<CODE>.jsonl; the report is <CODE>-report.md.

// Measured by the server, never by the agent.
export type TurnMetrics = {
  durationMs: number
  attempts: number
  engineChanged: boolean
  engineError?: string
  failed: boolean
}

export const ReflectionSchema = z.object({
  // Short kebab-case names for the mechanics the card used, e.g. "steal-points".
  mechanics: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40)).max(8),
  // How the ruling fit the existing rules: conflicts, overrides, dead rules.
  integration: z.string().max(1000),
  // What made this ruling slow, wasteful, or error-prone.
  friction: z.string().max(1000),
  // One concrete change that would make fast mode faster for cards like this.
  suggestion: z.string().max(1000),
})
export type Reflection = z.infer<typeof ReflectionSchema>

export type ReflectionInput = {
  turn: number
  playerName: string
  card: CardFace
  rulesBefore: Rules
  rulesAfter: Rules
  verdict: Omit<AgentVerdict, "enginePatch">
  enginePatchChars: number
  metrics: TurnMetrics
  // Names in the snippet library, so reflections can say which one fit or was missing.
  snippets?: string[]
}

export type LearningNote = {
  at: string
  turn: number
  cardId: string
  playerName: string
  card: { title?: string; text: string }
  effects: string[]
  rulesChanged: string[]
  metrics: TurnMetrics
  reflection: Reflection | null
  reflectionError?: string
}

export type ReportInput = { gameCode: string; notes: LearningNote[]; stats: string }

export type LearningStatus = { notes: number; report: "none" | "pending" | "ready" | "failed" }
