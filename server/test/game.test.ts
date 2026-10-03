import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { WebSocket } from 'ws'
import { GameConfigSchema, baseRules, type ClientMsg, type ServerMsg, type GameState, type Play } from '@cards/shared'
import { Rooms, type Peer } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'
import { interpretPlay, runEngine } from '../src/engineHost.ts'
import { composeCard } from '../src/cards.ts'
import { createGameServer } from '../src/index.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const source = await readFile(new URL('../../game/engine.mjs', import.meta.url), 'utf8')
const canvas = createCanvas(20, 20)
canvas.getContext('2d').fillRect(0, 0, 20, 20)
const draft = { title: 'Ten', text: '+10 points', art: canvas.toDataURL('image/png') }
function peer() {
  const messages: ServerMsg[] = []
  const connection: Peer = { send: message => messages.push(message) }
  return { connection, messages }
}
async function setup(t: { after: (fn: () => Promise<void>) => void }, agent = new MockAgent()) {
  const directory = await mkdtemp('/tmp/opencode/cards-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory, agent)
  await rooms.load()
  const a = peer(), b = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'A', configOverrides: { cardsPerPlayer: 2, handSize: 1, targetScore: 10 } })
  const room = a.connection.room!
  await rooms.handle(b.connection, { type: 'joinRoom', code: room.code, name: 'B' })
  return { rooms, room, a, b, directory }
}
async function author(rooms: Rooms, ...peers: Peer[]) {
  for (const p of peers) for (let i = 0; i < 2; i++) await rooms.handle(p, { type: 'submitCard', card: draft })
}

test('authoring quotas, host start, private snapshots, authorization, chat, turn and win', async t => {
  const { rooms, room, a, b } = await setup(t)
  await assert.rejects(rooms.handle(a.connection, { type: 'startGame' }), /quota/)
  await assert.rejects(rooms.handle(b.connection, { type: 'startGame' }), /host/)
  await author(rooms, a.connection, b.connection)
  await assert.rejects(rooms.handle(a.connection, { type: 'submitCard', card: draft }), /quota/)
  const own = rooms.view(room, a.connection.playerId!).myCards[0]
  assert.ok(rooms.image(room.code, own.id, room.seats[0].token))
  assert.equal(rooms.image(room.code, own.id, room.seats[1].token), null)
  assert.equal(rooms.image(room.code, own.id, 'bad'), null)
  await assert.rejects(rooms.handle(b.connection, { type: 'deleteCard', cardId: own.id }), /owned/)
  await rooms.handle(a.connection, { type: 'startGame' })
  assert.equal(room.state!.deck.length, 2)
  assert.equal(new Set([...room.state!.deck, ...room.state!.players.flatMap(p => p.hand)]).size, 4)
  const av = rooms.view(room, a.connection.playerId!), bv = rooms.view(room, b.connection.playerId!)
  assert.equal(av.myCards.length, 0); assert.equal(bv.myCards.length, 0)
  assert.equal(av.hand.length, 1); assert.equal(bv.hand.length, 1)
  assert.ok(!JSON.stringify(av).includes(bv.hand[0].id))
  assert.ok(!JSON.stringify(av).includes(room.seats[1].token))
  assert.equal(rooms.image(room.code, bv.hand[0].id, room.seats[0].token), null)
  await rooms.handle(b.connection, { type: 'say', text: 'hello' })
  assert.equal(room.thread.at(-1)?.kind, 'chat')
  const current = room.state!.turn.playerId === a.connection.playerId ? a.connection : b.connection
  const other = current === a.connection ? b.connection : a.connection
  const cardId = room.state!.players.find(p => p.id === current.playerId)!.hand[0]
  const otherCard = room.state!.players.find(p => p.id === other.playerId)!.hand[0]
  await assert.rejects(rooms.handle(other, { type: 'playCard', cardId: otherCard }), /turn/)
  await assert.rejects(rooms.handle(current, { type: 'playCard', cardId: otherCard }), /hand/)
  await rooms.handle(current, { type: 'playCard', cardId })
  assert.equal(room.phase, 'ended'); assert.equal(room.state!.winnerId, current.playerId)
  assert.equal(room.state!.players.find(p => p.id === current.playerId)!.score, 10)
  assert.ok(rooms.image(room.code, cardId, room.seats.find(s => s.id === other.playerId)!.token))
  await assert.rejects(rooms.handle(current, { type: 'playCard', cardId }), /Cannot play/)
  await assert.rejects(rooms.handle(peer().connection, { type: 'joinRoom', code: room.code, name: 'late' }), /started/)
})

test('resume and persistence preserve tokens, cards, state and private hands', async t => {
  const { rooms, room, a, b, directory } = await setup(t)
  await author(rooms, a.connection, b.connection)
  await rooms.handle(a.connection, { type: 'startGame' })
  const token = room.seats[0].token
  rooms.disconnect(a.connection)
  assert.equal(rooms.view(room, room.seats[1].id).players[0].connected, false)
  const reloaded = new Rooms(config, directory); await reloaded.load()
  const reconnect = peer()
  await assert.rejects(reloaded.handle(reconnect.connection, { type: 'resume', code: room.code, token: 'bad' }), /Invalid/)
  await reloaded.handle(reconnect.connection, { type: 'resume', code: room.code, token })
  assert.equal(reconnect.connection.playerId, room.seats[0].id)
  assert.deepEqual(reconnect.connection.room!.state, room.state)
  assert.deepEqual(reloaded.view(reconnect.connection.room!, reconnect.connection.playerId!).hand, rooms.view(room, room.seats[0].id).hand)
  const replacement = peer()
  await reloaded.handle(replacement.connection, { type: 'resume', code: room.code, token })
  await assert.rejects(reloaded.handle(reconnect.connection, { type: 'say', text: 'spoof' }), /not joined/)
})

test('bad candidate rolls back rules and engine after configured retries, consumes card explicitly', async t => {
  let attempts = 0
  const errors: (string | undefined)[] = []
  const agent = new MockAgent(input => {
    attempts++; errors.push(input.previousError)
    return { narration: 'broken', effects: [{ kind: 'score', amount: 999 }], rulesPatch: { targetScore: 1 }, enginePatch: 'export const meta = { version: 2 }; throw new Error("broken patch")' }
  })
  const { rooms, room, a, b } = await setup(t, agent)
  await author(rooms, a.connection, b.connection); await rooms.handle(a.connection, { type: 'startGame' })
  const player = room.state!.players.find(p => p.id === room.state!.turn.playerId)!
  const cardId = player.hand[0]
  await rooms.handle(player.id === a.connection.playerId ? a.connection : b.connection, { type: 'playCard', cardId })
  assert.equal(attempts, config.agent.maxRollbackRetries + 1)
  assert.equal(errors[0], undefined); assert.match(errors[1]!, /broken patch/)
  assert.equal(room.source, source); assert.equal(room.state!.rules.targetScore, 10)
  assert.equal(room.state!.players.find(p => p.id === player.id)!.score, 0)
  assert.ok(room.state!.discard.includes(cardId)); assert.notEqual(room.state!.turn.playerId, player.id)
  const entry = room.thread.at(-1)!
  assert.equal(entry.kind, 'verdict')
  if (entry.kind === 'verdict') { assert.match(entry.verdict.narration, /failed/); assert.ok(entry.engineError) }
})

test('accepted engine and rule patches are room-local; restart resolves interrupted play', async t => {
  const agent = new MockAgent(() => ({ narration: 'new engine', effects: [], rulesPatch: { targetScore: 999 }, enginePatch: source.replace('version: 1', 'version: 2') }))
  const { rooms, room, a, b, directory } = await setup(t, agent)
  await author(rooms, a.connection, b.connection); await rooms.handle(a.connection, { type: 'startGame' })
  const second = peer()
  await rooms.handle(second.connection, { type: 'createRoom', name: 'other' })
  const player = room.state!.players.find(p => p.id === room.state!.turn.playerId)!
  await rooms.handle(player.id === a.connection.playerId ? a.connection : b.connection, { type: 'playCard', cardId: player.hand[0] })
  assert.equal(room.version, 2); assert.equal(room.state!.rules.targetScore, 999)
  assert.equal(second.connection.room!.source, source); assert.equal(second.connection.room!.version, 1)
  const pending = room.state!.players.find(p => p.id === room.state!.turn.playerId)!.hand[0]
  room.pendingCard = pending; await rooms.save(room)
  const restart = new Rooms(config, directory); await restart.load()
  const recovered = restart.rooms.get(room.code)!
  assert.equal(recovered.pendingCard, null); assert.ok(recovered.state!.discard.includes(pending))
  assert.equal(recovered.version, 2)
})

function engineInput() {
  const state: GameState = { players: [{ id: 'a', name: 'A', score: 0, hand: ['c', 'd'] }, { id: 'b', name: 'B', score: 0, hand: ['e'] }], deck: ['f'], discard: [], turn: { playerId: 'a', number: 1, playsThisTurn: 0 }, rules: baseRules(100, 2), vars: {}, winnerId: null }
  const play: Play = { playerId: 'a', card: { id: 'c', authorId: 'b', text: 'test' }, effects: [] }
  return { state, play }
}

test('engine handles score, draw, reverse, skip and cardsPerTurn; rejects unknown effects', async () => {
  const { state, play } = engineInput()
  const result = await runEngine(source, state, { ...play, effects: [{ kind: 'score', target: 'b', amount: -5 }, { kind: 'draw', amount: 1 }, { kind: 'reverse' }, { kind: 'skip', amount: 1 }] }, 2000)
  assert.equal(result.result!.state.players[1].score, -5)
  assert.equal(result.result!.state.rules.direction, -1)
  assert.equal(result.result!.state.turn.playerId, 'a')
  assert.ok(result.result!.state.players[0].hand.includes('f'))
  state.rules.cardsPerTurn = 2
  const multi = await runEngine(source, state, play, 2000)
  assert.equal(multi.result!.state.turn.playerId, 'a'); assert.equal(multi.result!.state.turn.playsThisTurn, 1)
  await assert.rejects(runEngine(source, state, { ...play, effects: [{ kind: 'invented' }] }, 2000), /Unknown effect/)
})

test('engine rejects imports, malformed results, host access and infinite loops', async () => {
  const { state, play } = engineInput()
  await assert.rejects(runEngine("import fs from 'node:fs';\n" + source, state, play, 2000), /imports are forbidden/)
  await assert.rejects(runEngine('process.exit(0);\n' + source, state, play, 2000), /process is not defined/)
  await assert.rejects(runEngine('while (true) {}\n' + source, state, play, 150), /timeout|timed out/i)
  await assert.rejects(runEngine(source.replace('state.discard.push(play.card.id)', 'state.discard.push("invented")'), state, play, 2000), /lost, duplicated, or invented/)
  await assert.rejects(runEngine(source.replace('return { state, events }', 'return { state: {}, events }'), state, play, 2000))
})

test('verdict and merged rules validated; agent timeout bounded', async () => {
  const { state, play } = engineInput()
  const input = { state, card: { ...play.card, png: draft.art }, playerId: 'a', rules: state.rules, engineSource: source, playerNames: { a: 'A', b: 'B' }, history: [] }
  const bad = await interpretPlay(new MockAgent(() => ({ narration: 'bad', effects: [], rulesPatch: { direction: 0 } })), input, 0, 2000)
  assert.ok(bad.error)
  const invalidVerdict = await interpretPlay(new MockAgent(() => ({ narration: '', effects: [], rulesPatch: {} })), input, 0, 2000)
  assert.ok(invalidVerdict.error)
  const hung = await interpretPlay(new MockAgent(() => new Promise(() => {})), input, 0, 30)
  assert.match(hung.error!, /Agent timeout/)
})

test('successful retry uses last-good state, not the rejected candidate', async () => {
  const { state, play } = engineInput()
  const input = { state, card: { ...play.card, png: draft.art }, playerId: 'a', rules: state.rules, engineSource: source, playerNames: { a: 'A', b: 'B' }, history: [] }
  let calls = 0
  const outcome = await interpretPlay(new MockAgent(value => {
    calls++
    assert.equal(value.state.players[0].score, 0)
    assert.equal(value.rules.targetScore, 100)
    if (!value.previousError) return { narration: 'bad rule', effects: [{ kind: 'score', amount: 999 }], rulesPatch: { direction: 0 } }
    return { narration: 'fixed', effects: [{ kind: 'score', amount: 20 }], rulesPatch: {} }
  }), input, 1, 2000)
  assert.equal(calls, 2); assert.equal(outcome.error, undefined)
  assert.equal(outcome.result!.result!.state.players[0].score, 20)
  assert.equal(state.players[0].score, 0)
})

test('minimum membership and owned deletion gate start; last card can end without winner', async t => {
  const directory = await mkdtemp('/tmp/opencode/cards-exhaustion-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory); await rooms.load()
  const a = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'A', configOverrides: { cardsPerPlayer: 1, handSize: 1 } })
  await rooms.handle(a.connection, { type: 'submitCard', card: draft })
  await assert.rejects(rooms.handle(a.connection, { type: 'startGame' }), /minimum players/)
  const id = a.connection.room!.cards[0].id
  await rooms.handle(a.connection, { type: 'deleteCard', cardId: id })
  assert.equal(a.connection.room!.cards.length, 0)
  rooms.disconnect(a.connection)
  await assert.rejects(rooms.handle(a.connection, { type: 'say', text: 'closed' }), /closed/)
  const solo = peer()
  await rooms.handle(solo.connection, { type: 'createRoom', name: 'solo', configOverrides: { minPlayers: 1, maxPlayers: 1, cardsPerPlayer: 1, handSize: 1, targetScore: 1000 } })
  await rooms.handle(solo.connection, { type: 'submitCard', card: draft })
  await rooms.handle(solo.connection, { type: 'startGame' })
  const room = solo.connection.room!
  await rooms.handle(solo.connection, { type: 'playCard', cardId: room.state!.players[0].hand[0] })
  assert.equal(room.phase, 'ended'); assert.equal(room.state!.winnerId, null)
  assert.equal(room.state!.deck.length, 0); assert.equal(room.state!.discard.length, 1)
})

test('card compositing validates PNG and text; output is opaque binary PNG with text', async () => {
  await assert.rejects(composeCard({ ...draft, text: 'x'.repeat(config.card.maxChars + 1) }, config.card))
  await assert.rejects(composeCard({ ...draft, art: 'data:image/png;base64,YmFk' }, config.card), /PNG/)
  const png = await composeCard(draft, config.card)
  const image = await loadImage(Buffer.from(png.split(',')[1], 'base64'))
  assert.equal(image.width, config.card.widthPx); assert.equal(image.height, config.card.heightPx)
  const result = createCanvas(image.width, image.height), ctx = result.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data
  for (let i = 0; i < pixels.length; i += 4) {
    assert.ok(pixels[i] === 0 || pixels[i] === 255)
    assert.equal(pixels[i], pixels[i + 1]); assert.equal(pixels[i], pixels[i + 2]); assert.equal(pixels[i + 3], 255)
  }
  const blankText = await composeCard({ ...draft, title: '', text: '' }, config.card)
  assert.notEqual(png, blankText)
})

test('card text up to maxChars shrinks to fit inside the card', async () => {
  const pixelsOf = async (png: string) => {
    const image = await loadImage(Buffer.from(png.split(',')[1], 'base64'))
    const ctx = createCanvas(image.width, image.height).getContext('2d')
    ctx.drawImage(image, 0, 0)
    return ctx.getImageData(0, 0, image.width, image.height).data
  }
  const full = 'W'.repeat(config.card.maxChars - 1)
  const withLast = await pixelsOf(await composeCard({ ...draft, text: full + 'W' }, config.card))
  const withoutLast = await pixelsOf(await composeCard({ ...draft, text: full + '.' }, config.card))
  // The final character is drawn, so it was not pushed off the bottom...
  assert.notDeepEqual(withLast, withoutLast)
  // ...and nothing is drawn in the bottom margin.
  const margin = Math.max(8, Math.round(config.card.widthPx * .04))
  const bottom = withLast.subarray((config.card.heightPx - margin) * config.card.widthPx * 4)
  assert.ok(bottom.every(value => value === 255))
})

test('actual websocket create/join/resume and HTTP protected image endpoint', async t => {
  const directory = await mkdtemp('/tmp/opencode/cards-http-')
  const app = await createGameServer({ config, directory })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as { port: number }).port
  const sockets: WebSocket[] = []
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    await new Promise<void>(resolve => app.ws.close(() => resolve()))
    await new Promise<void>(resolve => app.server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(socket)
    const inbox: ServerMsg[] = []
    socket.on('message', bytes => inbox.push(JSON.parse(bytes.toString())))
    await new Promise<void>(resolve => socket.once('open', resolve))
    const next = async (message: ClientMsg, type: ServerMsg['type']) => {
      inbox.length = 0; socket.send(JSON.stringify(message))
      for (let i = 0; i < 200; i++) {
        const found = inbox.find(m => m.type === type)
        if (found) return found
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(`No ${type} response`)
    }
    return { socket, next }
  }
  const a = await connect()
  const joined = await a.next({ type: 'createRoom', name: 'A' }, 'joined')
  assert.equal(joined.type, 'joined'); if (joined.type !== 'joined') return
  const state = await a.next({ type: 'submitCard', card: draft }, 'state')
  assert.equal(state.type, 'state'); if (state.type !== 'state') return
  const url = `http://127.0.0.1:${port}${state.snapshot.myCards[0].imageUrl}`
  assert.equal((await fetch(url)).status, 200)
  assert.equal((await fetch(url.split('?')[0])).status, 404)
  const b = await connect()
  const bj = await b.next({ type: 'joinRoom', code: joined.code, name: 'B' }, 'joined')
  assert.equal(bj.type, 'joined'); if (bj.type !== 'joined') return
  assert.equal((await fetch(url.split('?')[0], { headers: { Authorization: `Bearer ${bj.token}` } })).status, 404)
  const resume = await connect()
  const rj = await resume.next({ type: 'resume', code: joined.code, token: joined.token }, 'joined')
  assert.equal(rj.type, 'joined'); if (rj.type === 'joined') assert.equal(rj.playerId, joined.playerId)
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
})
