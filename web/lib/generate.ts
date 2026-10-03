import type { RoomSnapshot } from "@cards/shared"

// How many cards this player may ask the agent for right now, or why not.
// The server enforces the same limits; this just keeps the button honest.
export function generateLimit(snap: RoomSnapshot): { max: number; blocked: string | null } {
  const { config } = snap
  const quotaLeft = config.cardsPerPlayer - snap.myCards.length
  if (snap.generating) return { max: 0, blocked: "The agent is already drawing." }
  if (snap.phase === "ended" && (snap.winnerId || snap.endedBy)) return { max: 0, blocked: "The game is over." }
  if (snap.generateRemaining <= 0) return { max: 0, blocked: "The agent has drawn all the cards this room allows." }
  if (snap.phase === "authoring" && quotaLeft <= 0) return { max: 0, blocked: "Your cards are all made." }
  const max = Math.min(config.generate.maxPerRequest, snap.generateRemaining, snap.phase === "authoring" ? quotaLeft : Infinity)
  return { max, blocked: null }
}
