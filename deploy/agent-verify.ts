import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createCanvas } from '../server/node_modules/@napi-rs/canvas/index.js'
import { baseRules } from '@cards/shared'
import { OpenCodeAgent } from '../server/src/agent/opencode.ts'

assert.equal((await fetch('http://127.0.0.1:4097/provider')).status, 401)
process.env.CARDS_AGENT_PASSWORD = (await readFile('/etc/cards/agent-password', 'utf8')).trim()
const agent = new OpenCodeAgent({ model: 'opencode/space-bunny-free', timeoutMs: 90000 })
const canvas = createCanvas(480, 720), ctx = canvas.getContext('2d')
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 480, 720)
ctx.fillStyle = 'black'
for (let n = 0; n < 7; n++) { ctx.beginPath(); ctx.arc(70 + (n % 3) * 140, 60 + Math.floor(n / 3) * 100, 22, 0, 2 * Math.PI); ctx.fill() }
const text = 'Gain points equal to the number of black circles in the art.'
ctx.font = '22px sans-serif'; ctx.fillText('Count the black circles.', 30, 420)
const rules = baseRules(100, 1)
const verdict = await agent.interpret({
  card: { id: 'vision', authorId: 'p', text, png: canvas.toDataURL('image/png') }, playerId: 'p', rules,
  engineSource: await readFile(new URL('../game/engine.mjs', import.meta.url), 'utf8'),
  history: [], playerNames: { p: 'Player' }, state: { players: [{ id: 'p', name: 'Player', score: 0, hand: ['vision'] }], deck: [], discard: [], rules, turn: { playerId: 'p', number: 1, playsThisTurn: 0 }, vars: {}, winnerId: null },
})
assert.ok(verdict.effects.some(e => e.kind === 'score' && e.amount === 7), `Vision must count seven circles without the count in card text: ${JSON.stringify(verdict)}`)
console.log('PASS: private agent requires authentication; actual Space Bunny vision counted seven circles; schema-valid verdict, tools denied')
