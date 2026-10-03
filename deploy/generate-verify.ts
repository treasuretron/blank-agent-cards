import { readFile } from 'node:fs/promises'
import { EXAMPLE_CARDS, GeneratedCardsSchema } from '@cards/shared'
import { OpenCodeAgent } from '../server/src/agent/opencode.ts'

// Run with sudo; credentials stay in memory and card contents are not logged.
process.env.CARDS_AGENT_PASSWORD = (await readFile('/etc/cards/agent-password', 'utf8')).trim()
const agent = new OpenCodeAgent({ model: 'opencode/space-bunny-free', timeoutMs: 90000 })
const prompt = agent.client.session.prompt.bind(agent.client.session)
agent.client.session.prompt = async (...args: Parameters<typeof prompt>) => {
  const response = await prompt(...args)
  if (response.data) console.log(JSON.stringify({ finish: response.data.info.finish, tokens: response.data.info.tokens, parts: response.data.parts.map(p => ({ type: p.type, ...(p.type === 'text' ? { length: p.text.length, maximumSteps: p.text.startsWith('Maximum steps'), synthetic: p.synthetic, ignored: p.ignored } : {}) })) }))
  return response
}
const started = Date.now()
const room = process.argv[3] ? JSON.parse(await readFile(`/var/lib/cards-game/rooms/${process.argv[3]}.json`, 'utf8')) : undefined
try {
  const cards = await agent.generateCards({
    count: Number(process.argv[2] ?? 4), limits: { titleMaxChars: 24, maxChars: 300 },
    examples: EXAMPLE_CARDS, existing: room?.cards.slice(-60).map(({ title, text }: { title?: string; text: string }) => ({ title, text })) ?? [], rules: room?.state?.rules ?? null,
    history: room?.history.slice(-10).map(({ playerName, card, narration }: { playerName: string; card: { title?: string; text: string }; narration: string }) => ({ playerName, card: { title: card.title, text: card.text }, narration })) ?? [],
  })
  GeneratedCardsSchema.parse({ cards })
  console.log(JSON.stringify({ ok: true, count: cards.length, elapsedMs: Date.now() - started, strokes: cards.map(c => c.doodle.length), points: cards.map(c => c.doodle.reduce((n, s) => n + s.length / 2, 0)) }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, elapsedMs: Date.now() - started, error: error instanceof Error ? error.name : 'Generation failed' }))
  process.exitCode = 1
}
