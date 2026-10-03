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

// What one card may be: title and rule text, plus a doodle clamped to fit.
const LenientCard = z.object({ title: z.string().optional(), text: z.string().trim().min(1), doodle: z.unknown().optional() })

export type GenerateInput = {
  count: number
  limits: { titleMaxChars: number; maxChars: number }
  // Built-in examples, cards other people saved on this server, then this
  // room's own cards.
  examples: { title?: string; text: string }[]
  savedCards: { title?: string; text: string }[]
  existing: { title?: string; text: string }[]
  // Set mid-game, so new cards can play off what has happened so far.
  rules: Rules | null
  history: { playerName: string; card: { title?: string; text: string }; narration: string }[]
}

// The model's JSON comes back malformed often enough to matter: a stray
// character, a truncated tail, or the occasional bad doodle. These keep
// whatever usable cards are in there instead of losing the whole batch.

// Drawings are capped rather than rejected, so an over-long one is trimmed.
export const MAX_STROKES = 16, MAX_STROKE_POINTS = 80

export function clampDoodle(doodle: unknown): Doodle {
  if (!Array.isArray(doodle)) return []
  const strokes: number[][] = []
  for (const raw of doodle.slice(0, MAX_STROKES)) {
    if (!Array.isArray(raw)) continue
    const points = raw.filter(n => typeof n === 'number' && Number.isFinite(n)).slice(0, MAX_STROKE_POINTS).map(n => Math.min(100, Math.max(0, Math.round(n))))
    const pairs = points.length - (points.length % 2)
    if (pairs >= 4) strokes.push(points.slice(0, pairs))
  }
  return strokes
}

// Every balanced {...} inside the cards array, so one malformed object doesn't
// hide the good ones after it. An object that never closes (a cut-off response)
// is the last casualty, and there is nothing to recover past it.
function balancedObjects(text: string): string[] {
  const bracket = text.indexOf('[')
  const objects: string[] = []
  let depth = 0, start = -1, inString = false, escaped = false
  for (let i = bracket + 1; i < text.length; i++) {
    const character = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') { if (depth++ === 0) start = i }
    else if (character === '}') { if (depth > 0 && --depth === 0) objects.push(text.slice(start, i + 1)) }
    else if (character === ']' && depth === 0) break
  }
  return objects
}

export function parseGeneratedCards(text: string): GeneratedCard[] {
  let candidates: unknown[] = []
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim())
    candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cards) ? parsed.cards : []
  } catch {
    candidates = balancedObjects(text)
  }
  const cards: GeneratedCard[] = []
  for (const raw of candidates) {
    // Salvaged candidates are still text.
    let candidate = raw
    if (typeof raw === 'string') { try { candidate = JSON.parse(raw) } catch { continue } }
    const card = LenientCard.safeParse(candidate)
    if (card.success) cards.push({ title: card.data.title ?? '', text: card.data.text, doodle: clampDoodle(card.data.doodle) })
  }
  return cards
}

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
