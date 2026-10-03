import { z } from "zod"
import type { CardFace } from "./card.ts"
import { CardDraftSchema } from "./card.ts"
import { ConfigOverridesSchema, GameModeSchema, type GameConfig } from "./config.ts"
import type { LearningStatus } from "./learning.ts"
import { SavedCardMetaSchema, SavedCardNameSchema, type LibraryCard } from "./library.ts"
import type { AgentVerdict, Rules } from "./rules.ts"

const RoomCodeSchema = z.string().regex(/^[A-Z]{4}$/)
const PlayerNameSchema = z.string().trim().min(1).max(24)

export const ClientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createRoom"), name: PlayerNameSchema, configOverrides: ConfigOverridesSchema.optional() }),
  z.object({ type: z.literal("joinRoom"), code: RoomCodeSchema, name: PlayerNameSchema }),
  z.object({ type: z.literal("resume"), code: RoomCodeSchema, token: z.string().min(1) }),
  z.object({ type: z.literal("submitCard"), card: CardDraftSchema }),
  z.object({ type: z.literal("deleteCard"), cardId: z.string() }),
  z.object({ type: z.literal("startGame") }),
  z.object({ type: z.literal("playCard"), cardId: z.string() }),
  z.object({ type: z.literal("say"), text: z.string().min(1).max(500) }),
  // Saved cards (M6). saveCards writes to the server library after the game ends;
  // importCard takes a locally saved pair, importLibraryCard a server-library one.
  z.object({ type: z.literal("saveCards"), cardIds: z.array(z.string()).min(1).max(100) }),
  z.object({ type: z.literal("listLibrary") }),
  z.object({ type: z.literal("importCard"), png: z.string().startsWith("data:image/png;base64,"), meta: SavedCardMetaSchema }),
  z.object({ type: z.literal("importLibraryCard"), name: SavedCardNameSchema }),
  // Host only, before the deal.
  z.object({ type: z.literal("setMode"), mode: GameModeSchema }),
  // Ask the agent to write cards: into your quota while authoring, into the deck
  // during play (or to restart a game that ran out of cards).
  z.object({ type: z.literal("generateCards"), count: z.number().int().min(1).max(20) }),
  // Any seated player, during play: the top score wins and the game is over.
  z.object({ type: z.literal("endGame") }),
])
export type ClientMsg = z.infer<typeof ClientMsgSchema>

// Cards travel to browsers by URL, not inline, so snapshots stay small.
export type CardView = CardFace & { imageUrl: string }

export type Phase = "authoring" | "play" | "ended"

export type ThreadEntry =
  | { id: string; at: number; kind: "system"; text: string }
  | { id: string; at: number; kind: "chat"; authorId: string; text: string }
  | { id: string; at: number; kind: "play"; authorId: string; card: CardView }
  | { id: string; at: number; kind: "verdict"; cardId: string; verdict: AgentVerdict; engineChanged: boolean; engineError?: string; events: string[] }

export type PlayerView = {
  id: string
  name: string
  score: number
  handCount: number
  cardsSubmitted: number
  connected: boolean
  isHost: boolean
}

export type RoomSnapshot = {
  code: string
  phase: Phase
  config: GameConfig
  youId: string
  players: PlayerView[]
  hand: CardView[]
  myCards: CardView[]
  turn: { playerId: string; number: number } | null
  rules: Rules | null
  engineVersion: number
  deckCount: number
  agentPending: boolean
  winnerId: string | null
  thread: ThreadEntry[]
  // Every card in the game, revealed once the phase is "ended"; empty before.
  gameCards: CardView[]
  // Learning mode progress; null in fast mode. The report is served over HTTP.
  learning: LearningStatus | null
  // The agent is writing cards for this player; one request per room at a time.
  generating: { playerId: string; count: number } | null
  // Cards the agent may still write in this room (config.generate.maxPerRoom).
  generateRemaining: number
  // Who pressed "end game", if the game was ended early; null otherwise.
  endedBy: string | null
}

export type ServerMsg =
  | { type: "joined"; code: string; token: string; playerId: string }
  | { type: "state"; snapshot: RoomSnapshot }
  | { type: "error"; message: string }
  | { type: "library"; cards: LibraryCard[] }
  | { type: "cardsSaved"; names: string[] }
