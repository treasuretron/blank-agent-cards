import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { GameConfigSchema, type ConfigOverrides, type GameAgent, type LearningNote, type ServerMsg } from '@cards/shared'
import { Rooms, type Peer, type Room } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'
import { learningStats } from '../src/learning.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const canvas = createCanvas(20, 20)
canvas.getContext('2d').fillRect(0, 0, 20, 20)
const art = canvas.toDataURL('image/png')

function peer() {
  const messages: ServerMsg[] = []
  const connection: Peer = { send: message => messages.push(message) }
  return { connection, messages }
}
async function game(t: { after: (fn: () => Promise<void>) => void }, agent: GameAgent, overrides: ConfigOverrides = {}) {
  const directory = await mkdtemp('/tmp/opencode/cards-learning-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory, agent)
  await rooms.load()
  const a = peer(), b = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'Ana', configOverrides: { cardsPerPlayer: 2, handSize: 1, targetScore: 10, ...overrides } })
  const room = a.connection.room!
  await rooms.handle(b.connection, { type: 'joinRoom', code: room.code, name: 'Bo' })
  for (const p of [a, b]) for (let i = 0; i < 2; i++) await rooms.handle(p.connection, { type: 'submitCard', card: { title: `Card ${i}`, text: `+10 points ${i}`, art } })
  return { rooms, room, a, b, directory }
}
async function playOne(rooms: Rooms, room: Room, a: Peer, b: Peer) {
  const current = room.state!.turn.playerId === a.playerId ? a : b
  await rooms.handle(current, { type: 'playCard', cardId: room.state!.players.find(p => p.id === current.playerId)!.hand[0] })
}
// Learning work is chained off the turn; wait until the chain stops growing.
async function settle(room: Room) {
  let chain: Promise<void>
  do { chain = room.learningChain; await chain; await room.queue } while (chain !== room.learningChain)
}
const notesOf = async (directory: string, code: string) => (await readFile(path.join(directory, 'learning', `${code}.jsonl`), 'utf8')).trim().split('\n').map(l => JSON.parse(l) as LearningNote)

test('fast mode is the default and writes no learning files', async t => {
  const { rooms, room, a, b, directory } = await game(t, new MockAgent())
  assert.equal(room.config.mode, 'fast')
  await rooms.handle(a.connection, { type: 'startGame' })
  await playOne(rooms, room, a.connection, b.connection)
  await settle(room)
  assert.equal(rooms.view(room, a.connection.playerId!).learning, null)
  await assert.rejects(stat(path.join(directory, 'learning')))
})

test('only the host switches mode, and only before the deal', async t => {
  const { rooms, room, a, b } = await game(t, new MockAgent())
  await assert.rejects(rooms.handle(b.connection, { type: 'setMode', mode: 'learning' }), /host/)
  await rooms.handle(a.connection, { type: 'setMode', mode: 'learning' })
  assert.equal(room.config.mode, 'learning')
  assert.deepEqual(rooms.view(room, b.connection.playerId!).learning, { notes: 0, report: 'none' })
  await rooms.handle(a.connection, { type: 'startGame' })
  await assert.rejects(rooms.handle(a.connection, { type: 'setMode', mode: 'fast' }), /fixed/)
})

test('learning mode records a reflected note per play and a report at the end', async t => {
  const { rooms, room, a, b, directory } = await game(t, new MockAgent(), { mode: 'learning' })
  await rooms.handle(a.connection, { type: 'startGame' })
  await playOne(rooms, room, a.connection, b.connection)
  assert.equal(room.phase, 'ended')
  await settle(room)
  const [note] = await notesOf(directory, room.code)
  assert.equal(note.turn, 1); assert.deepEqual(note.effects, ['score'])
  assert.equal(note.metrics.attempts, 1); assert.equal(note.metrics.failed, false)
  assert.ok(note.metrics.durationMs >= 0)
  assert.deepEqual(note.reflection?.mechanics, ['score'])
  assert.deepEqual(rooms.view(room, a.connection.playerId!).learning, { notes: 1, report: 'ready' })
  const report = await rooms.learningReport(room.code, room.seats[1].token)
  assert.match(report!, /^# Learning report: game [A-Z]{4}/)
  assert.match(report!, /\| plays \| 1 \|/)
  assert.match(report!, /Mock advice for [A-Z]{4} over 1 plays/)
  assert.match(report!, /mechanics: `score`/)
  assert.equal(await rooms.learningReport(room.code, 'bad'), null)
  // The persisted room keeps the status.
  const saved = JSON.parse(await readFile(path.join(directory, `${room.code}.json`), 'utf8'))
  assert.deepEqual(saved.learning, { notes: 1, report: 'ready' })
})

test('agents without learning steps, or whose steps fail, still get notes and a report', async t => {
  const plain: GameAgent = { interpret: input => new MockAgent().interpret(input) }
  const one = await game(t, plain, { mode: 'learning' })
  await one.rooms.handle(one.a.connection, { type: 'startGame' })
  await playOne(one.rooms, one.room, one.a.connection, one.b.connection)
  await settle(one.room)
  assert.equal((await notesOf(one.directory, one.room.code))[0].reflection, null)
  assert.match((await one.rooms.learningReport(one.room.code, one.room.seats[0].token))!, /no report step/)

  const broken = Object.assign(new MockAgent(), { reflect: async () => { throw new Error('reflection exploded') }, report: async () => { throw new Error('report exploded') } })
  const two = await game(t, broken, { mode: 'learning' })
  await two.rooms.handle(two.a.connection, { type: 'startGame' })
  await playOne(two.rooms, two.room, two.a.connection, two.b.connection)
  await settle(two.room)
  assert.equal((await notesOf(two.directory, two.room.code))[0].reflectionError, 'reflection exploded')
  const report = (await two.rooms.learningReport(two.room.code, two.room.seats[0].token))!
  assert.match(report, /could not write advice: report exploded/)
  assert.match(report, /No reflection: reflection exploded/)
})

test('failed interpretations are noted with their error and attempt count', async t => {
  const failing: GameAgent = { interpret: async () => { throw new Error('model offline') } }
  const { rooms, room, a, b, directory } = await game(t, failing, { mode: 'learning' })
  await rooms.handle(a.connection, { type: 'startGame' })
  await playOne(rooms, room, a.connection, b.connection)
  await settle(room)
  const [note] = await notesOf(directory, room.code)
  assert.equal(note.metrics.failed, true)
  assert.equal(note.metrics.attempts, config.agent.maxRollbackRetries + 1)
  assert.match(note.metrics.engineError!, /model offline/)
  assert.equal(note.reflection, null)
})

test('a report interrupted by a restart is rebuilt on load', async t => {
  const { rooms, room, a, b, directory } = await game(t, new MockAgent(), { mode: 'learning' })
  await rooms.handle(a.connection, { type: 'startGame' })
  await playOne(rooms, room, a.connection, b.connection)
  await settle(room)
  room.learning = { notes: 1, report: 'pending' }
  await rooms.save(room)
  await rm(path.join(directory, 'learning', `${room.code}-report.md`))
  const reloaded = new Rooms(config, directory, new MockAgent())
  await reloaded.load()
  const again = reloaded.rooms.get(room.code)!
  await settle(again)
  assert.equal(again.learning?.report, 'ready')
  assert.match((await reloaded.learningReport(room.code, room.seats[0].token))!, /Mock advice/)
})

test('stats summarize timing, failures, retries, rewrites and recurring mechanics', () => {
  const note = (turn: number, durationMs: number, extra: Partial<LearningNote['metrics']> = {}, mechanics: string[] = []): LearningNote => ({
    at: '', turn, cardId: `c${turn}`, playerName: 'Ana', card: { title: `T${turn}`, text: '' }, effects: ['score'], rulesChanged: [],
    metrics: { durationMs, attempts: 1, engineChanged: false, failed: false, ...extra },
    reflection: { mechanics, integration: '', friction: '', suggestion: '' },
  })
  const stats = learningStats([note(1, 1000, {}, ['steal-points']), note(2, 9000, { attempts: 2, engineChanged: true }, ['steal-points', 'skip-turn']), note(3, 3000, { failed: true })])
  assert.match(stats, /\| plays \| 3 \|/)
  assert.match(stats, /\| failed interpretations \| 1 \|/)
  assert.match(stats, /\| retries after a rejected patch \| 1 \|/)
  assert.match(stats, /\| engine rewrites \| 1 \|/)
  assert.match(stats, /median \| 3\.0s/)
  assert.match(stats, /slowest \| 9\.0s/)
  assert.match(stats, /- turn 2, "T2": 9\.0s, rewrote the engine, 2 attempts/)
  assert.match(stats, /`steal-points` ×2, `skip-turn` ×1/)
  assert.equal(learningStats([]), 'No plays were recorded.')
})
