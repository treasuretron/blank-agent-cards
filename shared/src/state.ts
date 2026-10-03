import type { CardFace } from "./card.ts"
import type { Effect, Rules } from "./rules.ts"

export type PlayerState = {
  id: string
  name: string
  score: number
  hand: string[]
}

// The object engine.mjs receives and returns. Plain JSON only.
export type GameState = {
  players: PlayerState[]
  deck: string[]
  discard: string[]
  turn: { playerId: string; number: number; playsThisTurn: number }
  rules: Rules
  vars: Record<string, unknown>
  winnerId: string | null
}

export type Play = {
  playerId: string
  card: CardFace
  effects: Effect[]
}

export type EngineEvent = { text: string }

export interface Engine {
  meta: { version: number }
  validatePlay(state: GameState, play: { playerId: string; card: CardFace }): { ok: boolean; reason?: string }
  applyPlay(state: GameState, play: Play): { state: GameState; events: EngineEvent[] }
  checkWin(state: GameState): { winnerId: string | null }
}
