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
