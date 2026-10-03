import { readFile, mkdtemp } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { createCanvas } from '@napi-rs/canvas'
import { baseRules } from '@cards/shared'
import { OpenCodeAgent } from '../src/agent/opencode.ts'

const ajv = new Ajv2020({ strict: false, loadSchema: async url => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Schema fetch failed: ${response.status}`)
  return response.json()
} })
const schema = await (await fetch('https://opencode.ai/config.json')).json()
const validate = await ajv.compileAsync(schema)
const config = JSON.parse(await readFile(new URL('../opencode.json', import.meta.url), 'utf8'))
if (!validate(config)) throw new Error(ajv.errorsText(validate.errors))
console.log('Config validated against https://opencode.ai/config.json')
if (!process.argv.includes('--smoke')) process.exit(0)

// A fresh profile avoids all existing credentials, including chat-session credentials.
const root = await mkdtemp('/tmp/opencode/cards-smoke-')
const reservation = createServer()
await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolve => reservation.close(() => resolve()))
const baseUrl = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./opencode-runtime.ts', import.meta.url))], {
  env: { PATH: process.env.PATH, CARDS_OPENCODE_HOME: root, CARDS_OPENCODE_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.resume(); child.stderr.resume()
let exited = false
child.on('exit', () => { exited = true })
try {
  const client = createOpencodeClient({ baseUrl, throwOnError: true })
  let loaded = false
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('Isolated runtime exited before readiness')
    try {
      const response = await client.config.get({}, { signal: AbortSignal.timeout(500) })
      if (response.data?.default_agent === 'card-referee') { loaded = true; break }
    } catch { /* Wait for private runtime initialization. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!loaded) throw new Error('Runtime did not load the referee configuration')
  console.log('CLI accepted config and loaded card-referee')
  const providers = (await client.provider.list({}, { signal: AbortSignal.timeout(15000) })).data!
  const models = providers.all.flatMap(p => Object.values(p.models).map(m => ({ id: `${p.id}/${m.id}`, connected: providers.connected.includes(p.id), image: m.capabilities.input.image, inputCost: m.cost.input, outputCost: m.cost.output })))
  console.log(JSON.stringify({ connectedProviders: providers.connected, connectedModels: models.filter(m => m.connected), spaceBunny: models.find(m => m.id === 'opencode/space-bunny-free') ?? 'not listed' }, null, 2))
  const selected = process.argv.indexOf('--model')
  const requested = selected < 0 ? undefined : process.argv[selected + 1]
  const candidate = models.find(m => (!requested || m.id === requested) && m.connected && m.image && m.inputCost === 0 && m.outputCost === 0)
  if (!candidate) { console.log('SMOKE BLOCKED: fresh profile has no connected zero-cost image model; human authentication/model selection required'); process.exitCode = 2 }
  else {
    console.log(`Attempting image smoke with catalog zero-cost model: ${candidate.id}`)
    const canvas = createCanvas(480, 720)
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 480, 720); ctx.fillStyle = 'black'; ctx.font = '30px sans-serif'; ctx.fillText('Gain 10 points', 30, 100)
    const rules = baseRules(100, 1)
    const verdict = await new OpenCodeAgent({ baseUrl, model: candidate.id, timeoutMs: 60000 }).interpret({
      card: { id: 'smoke', authorId: 'p', text: 'Gain 10 points', png: canvas.toDataURL('image/png') }, playerId: 'p', rules,
      engineSource: await readFile(new URL('../../game/engine.mjs', import.meta.url), 'utf8'),
      history: [], playerNames: { p: 'Player' }, state: { players: [{ id: 'p', name: 'Player', score: 0, hand: ['smoke'] }], deck: [], discard: [], rules, turn: { playerId: 'p', number: 1, playsThisTurn: 0 }, vars: {}, winnerId: null },
    })
    console.log(`SMOKE PASSED: ${candidate.id}; schema-valid verdict, ${verdict.effects.length} effects; engine source not executed`)
  }
} catch (error) {
  console.log(`SMOKE BLOCKED: ${error instanceof Error ? error.message : 'Unknown runtime failure'}`)
  process.exitCode = 2
} finally {
  child.kill('SIGTERM')
  await new Promise<void>(resolve => { if (exited) resolve(); else child.once('exit', () => resolve()) })
}
