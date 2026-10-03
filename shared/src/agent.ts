import type { Card } from "./card.ts"
import type { AgentVerdict, Rules } from "./rules.ts"
import type { GameState } from "./state.ts"
import type { Reflection, ReflectionInput, ReportInput } from "./learning.ts"

export type HistoryEntry = {
  turn: number
  playerName: string
  card: { title?: string; text: string }
  narration: string
}

export type AgentInput = {
  card: Card
  playerId: string
  rules: Rules
  engineSource: string
  state: GameState
  playerNames: Record<string, string>
  history: HistoryEntry[]
  // Set on a retry after the previous enginePatch failed validation.
  previousError?: string
}

export interface GameAgent {
  interpret(input: AgentInput): Promise<AgentVerdict>
  // Learning mode only, run outside the turn's critical path. An agent without
  // these still gets server-measured notes and a stats-only report.
  reflect?(input: ReflectionInput): Promise<Reflection>
  // Markdown advice for making fast mode faster, from the game's notes.
  report?(input: ReportInput): Promise<string>
}
