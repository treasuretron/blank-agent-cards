import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { baseRules, EXAMPLE_CARDS, type GenerateInput, type AgentInput } from '@cards/shared'
import { OpenCodeAgent } from '../src/agent/opencode.ts'
import { interpretPlay } from '../src/engineHost.ts'
import { Rooms } from '../src/rooms.ts'
import { GameConfigSchema } from '@cards/shared'
import { readFile } from 'node:fs/promises'

const rules = baseRules(100, 1)
const input: AgentInput = {
  card: { id: 'card', authorId: 'p', text: 'Gain ten points', png: 'data:image/png;base64,aW1hZ2U=' },
  playerId: 'p', rules, engineSource: 'current engine', history: [], playerNames: { p: 'Player' }, previousError: 'Previous failure',
  state: { players: [{ id: 'p', name: 'Player', score: 0, hand: ['card'] }], deck: [], discard: [], rules, turn: { playerId: 'p', number: 1, playsThisTurn: 0 }, vars: {}, winnerId: null },
}
const verdict = { narration: 'Ten points!', effects: [{ kind: 'score', amount: 10 }], rulesPatch: {}, enginePatch: 'full source' }

async function mock(t: { after(fn: () => Promise<void>): void }, options: { text?: string; texts?: string[]; error?: string; delay?: number; image?: boolean; connected?: boolean; status?: number; wrongSession?: boolean; tool?: boolean } = {}) {
  const requests: { path: string; body: any; authorization?: string }[] = []
  let count = 0
  const server = createServer(async (req, res) => {
    let bytes = ''
    for await (const chunk of req) bytes += chunk
    const path = req.url!.split('?')[0]
    requests.push({ path, body: bytes ? JSON.parse(bytes) : undefined, authorization: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    if (path === '/provider') return res.end(JSON.stringify({ connected: options.connected === false ? [] : ['test'], all: [{ id: 'test', models: { vision: { capabilities: { input: { image: options.image !== false } } } } }] }))
    if (path === '/session') return res.end(JSON.stringify({ id: `session-${++count}` }))
    if (path.endsWith('/message')) {
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay))
      res.statusCode = options.status ?? 200
      return res.end(JSON.stringify({ info: { sessionID: options.wrongSession ? 'wrong' : path.split('/')[2], providerID: 'test', modelID: 'vision', ...(options.error ? { error: { name: options.error } } : {}) }, parts: options.tool ? [{ type: 'tool' }] : [{ type: 'text', text: options.texts?.shift() ?? options.text ?? JSON.stringify(verdict) }] }))
    }
    res.end('true')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const agent = new OpenCodeAgent({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: 'test/vision', timeoutMs: 1000 })
  return { agent, requests }
}

test('SDK HTTP shape includes image, explicit model, context and deny permissions; sessions are isolated and removed', async t => {
  const { agent, requests } = await mock(t)
  const results = await Promise.all([agent.interpret(input), agent.interpret(input)])
  assert.deepEqual(results, [verdict, verdict])
  const prompts = requests.filter(r => r.path.endsWith('/message'))
  assert.notEqual(prompts[0].path, prompts[1].path)
  for (const prompt of prompts) {
    assert.deepEqual(prompt.body.model, { providerID: 'test', modelID: 'vision' })
    assert.equal(prompt.body.agent, 'card-referee')
    assert.deepEqual(prompt.body.format, { type: 'text' })
    assert.deepEqual(prompt.body.tools, { '*': false })
    assert.deepEqual(prompt.body.parts[1], { type: 'file', mime: 'image/png', filename: 'card.png', url: input.card.png })
    const context = JSON.parse(prompt.body.parts[0].text).context
    assert.equal(context.card.png, undefined)
    assert.deepEqual(context, { ...input, card: { id: 'card', authorId: 'p', text: 'Gain ten points' } })
  }
  assert.deepEqual(requests.find(r => r.path === '/session')!.body.permission, [{ permission: '*', pattern: '*', action: 'deny' }])
  assert.equal(requests.filter(r => r.path.endsWith('/abort')).length, 2)
  assert.equal(requests.filter(r => /^\/session\/session-\d+$/.test(r.path)).length, 2)
})

const generateInput: GenerateInput = { count: 2, limits: { titleMaxChars: 24, maxChars: 300 }, examples: EXAMPLE_CARDS, savedCards: [], existing: [], rules: null, history: [] }
const generated = { title: 'Lunch', text: 'Gain 5 points for your imaginary sandwich.', doodle: [[10, 10, 20, 20]] }

test('card writing retries malformed or maximum-steps output in a fresh session, without images', async t => {
  const { agent, requests } = await mock(t, { texts: ['Maximum steps reached', '```json\n' + JSON.stringify({ cards: [generated] }) + '\n```'] })
  assert.deepEqual(await agent.generateCards(generateInput), [generated])
  const prompts = requests.filter(r => r.path.endsWith('/message'))
  assert.equal(prompts.length, 2)
  assert.notEqual(prompts[0].path, prompts[1].path)
  assert.equal(prompts[0].body.parts.length, 1)
  assert.ok(JSON.parse(prompts[1].body.parts[0].text).previousError)
  assert.equal(requests.filter(r => r.path.endsWith('/abort')).length, 2)
})

test('card writing keeps valid siblings, bounds count, and does not retry partial success', async t => {
  const odd = { title: 'Odd', text: 'A card whose doodle ends mid-line.', doodle: [[1, 2, 3, 4, 5]] }
  const second = { title: 'Two', text: 'Draw 2 cards.', doodle: [] }
  const third = { title: 'Three', text: 'Reverse play.', doodle: [] }
  const { agent, requests } = await mock(t, { text: JSON.stringify({ cards: [odd, second, third] }) })
  const cards = await agent.generateCards(generateInput)
  assert.deepEqual(cards.map(c => c.title), ['Odd', 'Two'])
  // A dodgy drawing is trimmed rather than costing the card its place in the batch.
  assert.deepEqual(cards[0].doodle, [[1, 2, 3, 4]])
  assert.equal(requests.filter(r => r.path.endsWith('/message')).length, 1)
})

test('card writing malformed output retries only once', async t => {
  const { agent, requests } = await mock(t, { text: 'not JSON' })
  await assert.rejects(agent.generateCards(generateInput), /no valid cards after one retry/)
  assert.equal(requests.filter(r => r.path.endsWith('/message')).length, 2)
})

test('card writing uses a single deadline across retry and cancels runtime work', async t => {
  const { agent, requests } = await mock(t, { delay: 120, text: 'not JSON' })
  agent.options.timeoutMs = 200
  const start = Date.now()
  await assert.rejects(agent.generateCards(generateInput), /timeout|aborted/i)
  assert.ok(Date.now() - start < 600)
  assert.equal(requests.filter(r => r.path.endsWith('/message')).length, 2)
  assert.equal(requests.filter(r => r.path.endsWith('/abort')).length, 2)
})

test('card writing does not retry provider errors or pre-cancelled requests', async t => {
  const { agent, requests } = await mock(t, { status: 500 })
  await assert.rejects(agent.generateCards(generateInput))
  assert.equal(requests.filter(r => r.path.endsWith('/message')).length, 1)
  await assert.rejects(agent.generateCards(generateInput, AbortSignal.abort(new Error('cancelled'))), /cancelled/)
  assert.equal(requests.filter(r => r.path.endsWith('/message')).length, 1)
})

test('private runtime password authenticates provider, prompt and cleanup requests', async t => {
  const old = process.env.CARDS_AGENT_PASSWORD
  process.env.CARDS_AGENT_PASSWORD = 'test-only-password'
  try {
    const { agent, requests } = await mock(t)
    await agent.interpret(input)
    assert.ok(requests.length >= 5)
    assert.ok(requests.every(r => r.authorization === `Basic ${Buffer.from('cards-game:test-only-password').toString('base64')}`))
  } finally {
    if (old === undefined) delete process.env.CARDS_AGENT_PASSWORD
    else process.env.CARDS_AGENT_PASSWORD = old
  }
})

for (const text of ['not JSON', '```json\n{}\n```', '{"narration":"ok"}', '{"narration":"","effects":[],"rulesPatch":{}}', '{"narration":"ok","effects":{},"rulesPatch":{}}', '{"narration":"ok","effects":[],"rulesPatch":{},"enginePatch":3}']) {
  test(`invalid verdict rejected: ${text}`, async t => {
    const { agent, requests } = await mock(t, { text })
    await assert.rejects(agent.interpret(input))
    assert.ok(requests.some(r => r.path.endsWith('/abort')))
  })
}
for (const options of [{ error: 'ProviderAuthError' }, { status: 500 }, { wrongSession: true }, { tool: true }, { image: false }, { connected: false }]) {
  test(`provider/response failure rejected: ${JSON.stringify(options)}`, async t => {
    const { agent } = await mock(t, options)
    await assert.rejects(agent.interpret(input))
  })
}
test('timeout and caller cancellation abort runtime work and cannot accept late verdicts', async t => {
  const { agent, requests } = await mock(t, { delay: 150 })
  const controller = new AbortController()
  const pending = agent.interpret(input, controller.signal)
  setTimeout(() => controller.abort(new Error('cancelled')), 50)
  await assert.rejects(pending, /cancelled/)
  assert.ok(requests.some(r => r.path.endsWith('/abort')))
  agent.options.timeoutMs = 50
  await assert.rejects(agent.interpret(input), /timeout/)
  const preCancelled = new AbortController(); preCancelled.abort(new Error('already cancelled'))
  await assert.rejects(agent.interpret(input, preCancelled.signal), /already cancelled/)
})
test('pipeline propagates deadline cancellation without changing GameAgent contract', async () => {
  let cancelled = false
  const result = await interpretPlay({ interpret: async (_input: AgentInput, signal?: AbortSignal) => {
    return new Promise<never>((_resolve, reject) => signal!.addEventListener('abort', () => { cancelled = true; reject(signal!.reason) }))
  } }, input, 0, 20)
  assert.equal(cancelled, true)
  assert.match(result.error!, /timeout/)
})
test('reject remote endpoints and unqualified models', () => {
  assert.throws(() => new OpenCodeAgent({ baseUrl: 'https://example.com', model: 'test/vision', timeoutMs: 1 }), /localhost/)
  assert.throws(() => new OpenCodeAgent({ model: 'vision', timeoutMs: 1 }), /provider\/model/)
})
test('private referee configuration does not inject the maximum-steps prompt on its first inference', async () => {
  const config = JSON.parse(await readFile(new URL('../opencode.json', import.meta.url), 'utf8'))
  assert.equal(config.agent['card-referee'].steps, 2)
  assert.deepEqual(config.permission, { '*': 'deny' })
  assert.deepEqual(config.tools, { '*': false })
})
test('normal room creation refuses generated engines without explicit trusted-local opt-in', async () => {
  const old = process.env.CARDS_ALLOW_GENERATED_ENGINE
  delete process.env.CARDS_ALLOW_GENERATED_ENGINE
  try {
    const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
    config.agent.provider = 'opencode'
    const rooms = new Rooms(config, '/tmp/opencode/unused-gated-room')
    await assert.rejects(rooms.handle({ send: () => {} }, { type: 'createRoom', name: 'Player' }), /trusted-local/)
    assert.equal(rooms.rooms.size, 0)
  } finally {
    if (old === undefined) delete process.env.CARDS_ALLOW_GENERATED_ENGINE
    else process.env.CARDS_ALLOW_GENERATED_ENGINE = old
  }
})
