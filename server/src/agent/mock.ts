import type { AgentInput, AgentVerdict, GameAgent, GeneratedCard, GenerateInput, Reflection, ReflectionInput, ReportInput } from '@cards/shared'

export class MockAgent implements GameAgent {
  constructor(private readonly script?: (input: AgentInput) => AgentVerdict | Promise<AgentVerdict>) {}
  async interpret(input: AgentInput): Promise<AgentVerdict> {
    if (this.script) return this.script(input)
    const text = `${input.card.title ?? ''} ${input.card.text}`
    const points = text.match(/([+-]?\d+)\s*(?:points?|score)/i)
    const draw = text.match(/draw\s+(\d+)/i)
    const target = text.match(/target\s*(?:score)?\s*(?:to|=)?\s*(\d+)/i)
    const effects: AgentVerdict['effects'] = []
    if (points) effects.push({ kind: 'score', amount: Number(points[1]) })
    if (draw) effects.push({ kind: 'draw', amount: Number(draw[1]) })
    if (/reverse/i.test(text)) effects.push({ kind: 'reverse' })
    if (/skip/i.test(text)) effects.push({ kind: 'skip', amount: 1 })
    if (!effects.length && !target) effects.push({ kind: 'score', amount: 10 })
    return { narration: `Mock interpretation: ${text.trim() || 'Gain 10 points.'}`, effects, rulesPatch: target ? { targetScore: Number(target[1]) } : {} }
  }

  // Learning mode stand-ins: tag mechanics by effect kind and rule key.
  async reflect(input: ReflectionInput): Promise<Reflection> {
    const mechanics = [...new Set([...input.verdict.effects.map(e => e.kind), ...Object.keys(input.verdict.rulesPatch).map(k => `rule-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`)])]
    return {
      mechanics,
      integration: Object.keys(input.verdict.rulesPatch).length ? `Changed ${Object.keys(input.verdict.rulesPatch).join(', ')}.` : 'No rule changes; immediate effects only.',
      friction: input.metrics.attempts > 1 ? 'Needed a retry.' : input.enginePatchChars ? 'Rewrote the engine.' : 'None.',
      suggestion: input.enginePatchChars ? 'Make this a reusable mechanic instead of an engine rewrite.' : 'Already handled by built-in effects.',
    }
  }

  async report(input: ReportInput): Promise<string> {
    return `Mock advice for ${input.gameCode} over ${input.notes.length} plays: every ruling used built-in effects.`
  }

  // Stand-in card writer: cards that interpret() above understands, each with a
  // random zigzag doodle, skipping any text already in the room.
  async generateCards(input: GenerateInput): Promise<GeneratedCard[]> {
    const taken = new Set([...input.existing, ...input.savedCards].map(c => c.text.toLowerCase()))
    const cards: GeneratedCard[] = []
    for (let i = 0; cards.length < input.count; i++) {
      const [title, base] = mockCards[i % mockCards.length]
      const text = i < mockCards.length ? base : `${base} (${Math.floor(i / mockCards.length) + 1})`
      if (taken.has(text.toLowerCase())) continue
      taken.add(text.toLowerCase())
      cards.push({ title, text, doodle: [Array.from({ length: 8 }, (_, j) => j % 2 ? 30 + Math.random() * 40 : 10 + j * 10)] })
    }
    return cards
  }
}

const mockCards: [string, string][] = [
  ['Lucky Penny', '+5 points'], ['Jackpot', '+20 points'], ['Oops', '-5 points'], ['Second Helping', 'Draw 2 cards'],
  ['U-Turn', 'Reverse the order of play'], ['Snooze', 'Skip the next player'], ['Moving Goalposts', 'Set the target score to 150'],
]
