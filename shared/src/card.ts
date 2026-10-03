import { z } from "zod"
import type { GameConfig } from "./config.ts"

// What a player submits from the studio: raw 1-bit art plus text. The server
// composites title + art + text into the final card PNG.
export const CardDraftSchema = z.object({
  title: z.string().optional(),
  text: z.string(),
  art: z.string().startsWith("data:image/png;base64,"),
})
export type CardDraft = z.infer<typeof CardDraftSchema>

export function cardDraftSchema(config: GameConfig["card"]) {
  return CardDraftSchema.extend({
    title: z.string().max(config.titleMaxChars).optional(),
    text: z.string().max(config.maxChars),
  })
}

export type Card = {
  id: string
  authorId: string
  title?: string
  text: string
  png: string
  // Written by the agent at authorId's request rather than drawn by a player.
  byAgent?: boolean
}

// What the engine sees: everything but the image.
export type CardFace = Omit<Card, "png">

export function cardFace({ png: _png, ...face }: Card): CardFace {
  return face
}
