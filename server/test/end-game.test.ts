import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { GameConfigSchema, type ConfigOverrides, type ServerMsg } from '@cards/shared'
import { Rooms, type Peer } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const canvas = createCanvas(20, 20)
canvas.getContext('2d').fillRect(0, 0, 20, 20)
const art = canvas.toDataURL('image/png')

function peer() {
  const messages: ServerMsg[] = []
  const connection: Peer = { send: message => messages.push(message) }
  return { connection, messages }
}
// Two players, two cards each, dealt; target score far away so nobody wins by playing.
async function dealt(t: { after: (fn: () => Promise<void>) => void }, overrides: ConfigOverrides = {}) {
  const directory = await mkdtemp('/tmp/opencode/cards-end-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory, new MockAgent())
  await rooms.load()
  const a = peer(), b = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'Ana', configOverrides: { cardsPerPlayer: 2, handSize: 1, targetScore: 500, ...overrides } })
  const room = a.connection.room!
  await rooms.handle(b.connection, { type: 'joinRoom', code: room.code, name: 'Bo' })
  await assert.rejects(rooms.handle(a.connection, { type: 'endGame' }), /no game in progress/)
  for (const p of [a, b]) for (let i = 0; i < 2; i++) await rooms.handle(p.connection, { type: 'submitCard', card: { text: `+${i + 1}0 points`, art } })
  await rooms.handle(a.connection, { type: 'startGame' })
  return { rooms, room, a, b, directory }
}

test('any player can end the game; the top score wins and every card can be saved', async t => {
  const { rooms, room, a, b } = await dealt(t)
  room.state!.players[0].score = 30; room.state!.players[1].score = 10
  await rooms.handle(b.connection, { type: 'endGame' })
  assert.equal(room.phase, 'ended')
  assert.equal(room.state!.winnerId, room.seats[0].id)
  const view = rooms.view(room, a.connection.playerId!)
  assert.equal(view.endedBy, b.connection.playerId)
  assert.equal(view.winnerId, a.connection.playerId)
  assert.equal(view.gameCards.length, 4)
  assert.match(JSON.stringify(room.thread.at(-1)), /Bo ended the game\. Ana wins with 30 points\./)
  await rooms.handle(a.connection, { type: 'saveCards', cardIds: [view.gameCards[0].id] })
  assert.ok(a.messages.some(m => m.type === 'cardsSaved'))
  await assert.rejects(rooms.handle(a.connection, { type: 'endGame' }), /no game in progress/)
  await assert.rejects(rooms.handle(a.connection, { type: 'playCard', cardId: view.gameCards[0].id }), /Cannot play/)
})

test('a tie at the top has no winner, and an ended game cannot be revived with new cards', async t => {
  const { rooms, room, a } = await dealt(t)
  await rooms.handle(a.connection, { type: 'endGame' })
  assert.equal(room.state!.winnerId, null)
  assert.equal(room.endedBy, a.connection.playerId)
  assert.match(JSON.stringify(room.thread.at(-1)), /tie between Ana and Bo on 0 points/)
  await assert.rejects(rooms.handle(a.connection, { type: 'generateCards', count: 1 }), /over/)
})

test('ending a learning-mode game writes its report', async t => {
  const { rooms, room, a } = await dealt(t, { mode: 'learning' })
  await rooms.handle(a.connection, { type: 'endGame' })
  await room.learningChain
  assert.equal(room.learning?.report, 'ready')
})

test('the end survives a restart', async t => {
  const { rooms, room, b, directory } = await dealt(t)
  await rooms.handle(b.connection, { type: 'endGame' })
  const reloaded = new Rooms(config, directory, new MockAgent())
  await reloaded.load()
  assert.equal(reloaded.view(reloaded.rooms.get(room.code)!, room.seats[0].id).endedBy, b.connection.playerId)
})
