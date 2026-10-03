import { z } from "zod"
import type { Rules } from "./rules.ts"

// Agent-written cards. A player asks for N cards, either while authoring (they
// fill that player's quota) or mid-game (they're shuffled into the deck). The
// agent sees built-in examples plus the cards already made, and answers with
// text and a stick-figure doodle that the server draws in black ink.

// A doodle is a list of strokes. Each stroke is a flat [x0, y0, x1, y1, ...]
// polyline on a 0–100 square, so a small model can draw without image output.
export const DoodleSchema = z
  .array(z.array(z.number().min(0).max(100)).min(4).max(80).refine((s) => s.length % 2 === 0, "Stroke needs x,y pairs"))
  .max(16)
export type Doodle = z.infer<typeof DoodleSchema>

export const GeneratedCardSchema = z.object({
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
  doodle: DoodleSchema.default([]),
})
export type GeneratedCard = z.infer<typeof GeneratedCardSchema>

export const GeneratedCardsSchema = z.object({ cards: z.array(GeneratedCardSchema).min(1) })

export type GenerateInput = {
  count: number
  limits: { titleMaxChars: number; maxChars: number }
  // Built-in examples first, then cards from this room and the server library.
  examples: { title?: string; text: string }[]
  existing: { title?: string; text: string }[]
  // Set mid-game, so new cards can play off what has happened so far.
  rules: Rules | null
  history: { playerName: string; card: { title?: string; text: string }; narration: string }[]
}

// Seed examples in the spirit of 1000 Blank White Cards
// (https://en.wikipedia.org/wiki/1000_Blank_White_Cards). The first is quoted
// in that article; the rest are written for this game in the same style: a
// title, a stick-figure picture, and a rule that scores, punishes, changes
// play, or does something nobody planned for.
export const EXAMPLE_CARDS: { title: string; text: string; doodle?: Doodle }[] = [
  { title: "Zinc", text: "Eat This!... In a few minutes, the ZINC will be entering your system." },
  { title: "Free Points", text: "+15 points. No reason.", doodle: [[30, 50, 70, 50], [50, 30, 50, 70]] },
  { title: "Stubbed Toe", text: "-10 points to whoever played the last card. They should have looked where they were going." },
  { title: "Reverse!", text: "Play now goes the other way around the table.", doodle: [[20, 40, 80, 40, 70, 30], [80, 60, 20, 60, 30, 70]] },
  { title: "Nap", text: "The next player skips their turn. Shh.", doodle: [[30, 30, 50, 30, 30, 50, 50, 50], [60, 55, 70, 55, 60, 65, 70, 65]] },
  { title: "Thief", text: "Steal 10 points from the player with the most points." },
  { title: "Inflation", text: "The target score goes up by 50. Everyone groans." },
  { title: "Group Hug", text: "Every player gets +5 points.", doodle: [[30, 30, 30, 70], [50, 30, 50, 70], [70, 30, 70, 70], [20, 45, 80, 45]] },
  { title: "Robin Hood", text: "Take 20 points from the leader and give them to the player in last place." },
  { title: "Speed Round", text: "From now on, everyone plays two cards per turn." },
  { title: "Double or Nothing", text: "Flip a coin (the agent decides). Heads: double your score. Tails: your score is 0." },
  { title: "Tax Man", text: "Every player with more than 50 points pays 10 points." },
  { title: "Mulligan", text: "Draw 2 cards." },
  { title: "Pacifist", text: "New rule: no card may take points away from another player. This card is worth +5." },
  { title: "The Accountant", text: "Points are now counted in tens. Divide everyone's score by 10, rounded down." },
  { title: "Bad Hair Day", text: "-5 points to every player whose name has more than 4 letters." },
  { title: "Uprising", text: "The player in last place wins if they reach 50 points instead of the target score." },
  { title: "Echo", text: "Repeat the effect of the last card played. Echo. Echo." },
  { title: "Gravity", text: "Every time a player scores, they lose 1 point for falling over." },
  { title: "Blank White Card", text: "This card does nothing. Treasure it." },
]
