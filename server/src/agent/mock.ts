import type { AgentInput, AgentVerdict, GameAgent } from '@cards/shared'

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
}
