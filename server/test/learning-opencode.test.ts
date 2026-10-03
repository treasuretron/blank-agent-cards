import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { baseRules, type ReflectionInput } from '@cards/shared'
import { OpenCodeAgent } from '../src/agent/opencode.ts'

// A text-only model: learning steps must not need image support.
async function mock(t: { after(fn: () => Promise<void>): void }, reply: string) {
  const requests: { path: string; body: any }[] = []
  const server = createServer(async (req, res) => {
    let bytes = ''
    for await (const chunk of req) bytes += chunk
    const path = req.url!.split('?')[0]
    requests.push({ path, body: bytes ? JSON.parse(bytes) : undefined })
    res.setHeader('Content-Type', 'application/json')
    if (path === '/provider') return res.end(JSON.stringify({ connected: ['test'], all: [{ id: 'test', models: { text: { capabilities: { input: { image: false } } } } }] }))
    if (path === '/session') return res.end(JSON.stringify({ id: 'session-1' }))
    if (path.endsWith('/message')) return res.end(JSON.stringify({ info: { sessionID: 'session-1', providerID: 'test', modelID: 'text' }, parts: [{ type: 'text', text: reply }] }))
    res.end('true')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { agent: new OpenCodeAgent({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: 'test/text', timeoutMs: 1000 }), requests }
}

const rules = baseRules(100, 3)
const input: ReflectionInput = {
  turn: 3, playerName: 'Ana', card: { id: 'c', authorId: 'a', title: 'Thief', text: 'Steal 5 points' },
  rulesBefore: rules, rulesAfter: rules, verdict: { narration: 'Stolen', effects: [{ kind: 'score', amount: 5 }], rulesPatch: {} },
  enginePatchChars: 0, metrics: { durationMs: 1200, attempts: 1, engineChanged: false, failed: false },
}

test('reflect sends a text-only, tool-less prompt and validates the reflection', async t => {
  const reflection = { mechanics: ['steal-points'], integration: 'fine', friction: 'none', suggestion: 'add a steal effect' }
  const { agent, requests } = await mock(t, JSON.stringify(reflection))
  assert.deepEqual(await agent.reflect(input), reflection)
  const prompt = requests.find(r => r.path.endsWith('/message'))!.body
  assert.equal(prompt.parts.length, 1)
  assert.deepEqual(prompt.tools, { '*': false })
  assert.match(prompt.system, /reviewing your own ruling/)
  assert.deepEqual(JSON.parse(prompt.parts[0].text).context, input)
  assert.equal(requests.find(r => r.path === '/session')!.body.title, 'Learning reflection')
  assert.ok(requests.some(r => r.path === '/session/session-1'), 'session is deleted')
})

test('reflect rejects output that does not match the schema', async t => {
  const { agent } = await mock(t, JSON.stringify({ mechanics: ['Not Kebab'], integration: '', friction: '', suggestion: '' }))
  await assert.rejects(agent.reflect(input))
})

test('report returns the model text as markdown', async t => {
  const { agent, requests } = await mock(t, '- make `steal-points` a snippet')
  assert.equal(await agent.report({ gameCode: 'ABCD', notes: [], stats: 'n/a' }), '- make `steal-points` a snippet')
  assert.match(requests.find(r => r.path.endsWith('/message'))!.body.system, /writing advice/)
})

test('generateCards sends a text-only prompt with saved cards and no image', async t => {
  const cards = [{ title: 'Moon', text: '+10 points if it is night', doodle: [[20, 20, 80, 80]] }, { title: 'Sun', text: 'Reverse play' }]
  const { agent, requests } = await mock(t, JSON.stringify({ cards }))
  const request = { count: 2, limits: { titleMaxChars: 24, maxChars: 300 }, examples: [{ title: 'Nap', text: 'Skip the next player' }], savedCards: [{ text: 'Free cards' }], existing: [], rules: null, history: [] }
  assert.deepEqual(await agent.generateCards(request), [cards[0], { ...cards[1], doodle: [] }])
  const prompt = requests.find(r => r.path.endsWith('/message'))!.body
  assert.equal(prompt.parts.length, 1)
  assert.deepEqual(prompt.tools, { '*': false })
  assert.match(prompt.system, /1000 Blank White Cards/)
  assert.match(prompt.system, /savedCards/)
  assert.deepEqual(JSON.parse(prompt.parts[0].text).context, request)
  assert.equal(requests.find(r => r.path === '/session')!.body.title, 'Card writing')
})

test('generateCards keeps the good cards when the JSON is broken', async t => {
  // One malformed object between two good ones, plus a truncated tail.
  const broken = '{"cards":[{"title":"Fine","text":"+5 points","doodle":[]},{"title":"Bad","text":"+3 points" "doodle":[]},{"title":"Also fine","text":"Draw 2 cards"},{"title":"Cut off","te'
  const { agent } = await mock(t, broken)
  const cards = await agent.generateCards({ count: 3, limits: { titleMaxChars: 24, maxChars: 300 }, examples: [], savedCards: [], existing: [], rules: null, history: [] })
  // The malformed object is dropped; the cards either side of it survive, and the
  // cut-off object at the end is the only real loss.
  assert.deepEqual(cards.map(c => c.text), ['+5 points', 'Draw 2 cards'])
})

test('generateCards trims an over-long or odd doodle instead of dropping the card', async t => {
  const long = Array.from({ length: 30 }, (_, i) => [i, 120, -5, 7.6])
  const { agent } = await mock(t, JSON.stringify({ cards: [{ title: 'Big', text: 'Draw 2 cards', doodle: long }] }))
  const [card] = await agent.generateCards({ count: 1, limits: { titleMaxChars: 24, maxChars: 300 }, examples: [], savedCards: [], existing: [], rules: null, history: [] })
  assert.equal(card.doodle.length, 16)
  assert.ok(card.doodle.every(stroke => stroke.length <= 80 && stroke.every(n => Number.isInteger(n) && n >= 0 && n <= 100)))
})
