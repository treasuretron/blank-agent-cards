import type { Card } from "./card.ts"
import type { AgentVerdict, Rules } from "./rules.ts"
import type { GameState } from "./state.ts"

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
}
