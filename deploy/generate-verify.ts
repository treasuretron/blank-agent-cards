import { readFile } from 'node:fs/promises'
import { EXAMPLE_CARDS, GeneratedCardsSchema } from '@cards/shared'
import { OpenCodeAgent } from '../server/src/agent/opencode.ts'

// Run with sudo; credentials stay in memory and card contents are not logged.
process.env.CARDS_AGENT_PASSWORD = (await readFile('/etc/cards/agent-password', 'utf8')).trim()
const agent = new OpenCodeAgent({ model: 'opencode/space-bunny-free', timeoutMs: 90000 })
const started = Date.now()
try {
  const cards = await agent.generateCards({
    count: Number(process.argv[2] ?? 4), limits: { titleMaxChars: 24, maxChars: 300 },
    examples: EXAMPLE_CARDS, existing: [], rules: null, history: [],
  })
  GeneratedCardsSchema.parse({ cards })
  console.log(JSON.stringify({ ok: true, count: cards.length, elapsedMs: Date.now() - started }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, elapsedMs: Date.now() - started, error: error instanceof Error ? error.name : 'Generation failed' }))
  process.exitCode = 1
}
