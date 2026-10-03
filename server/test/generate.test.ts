import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { EXAMPLE_CARDS, GameConfigSchema, type ConfigOverrides, type GameAgent, type GeneratedCard, type GenerateInput, type ServerMsg } from '@cards/shared'
import { Rooms, type Peer, type Room } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'
import { renderDoodle } from '../src/cards.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const canvas = createCanvas(20, 20)
canvas.getContext('2d').fillRect(0, 0, 20, 20)
const art = canvas.toDataURL('image/png')

function peer() {
  const messages: ServerMsg[] = []
  const connection: Peer = { send: message => messages.push(message) }
  return { connection, messages }
}
async function setup(t: { after: (fn: () => Promise<void>) => void }, agent: GameAgent = new MockAgent(), overrides: ConfigOverrides = { cardsPerPlayer: 2, handSize: 1, targetScore: 10 }) {
  const directory = await mkdtemp('/tmp/opencode/cards-generate-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory, agent)
  await rooms.load()
  const a = peer(), b = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'Ana', configOverrides: overrides })
  const room = a.connection.room!
  await rooms.handle(b.connection, { type: 'joinRoom', code: room.code, name: 'Bo' })
  return { rooms, room, a, b, directory }
}
// Generation runs off the room queue; wait for it to land.
async function settle(room: Room) {
  while (room.generating) await new Promise(resolve => setTimeout(resolve, 5))
  await room.queue
}
function writer(cards: (input: GenerateInput) => GeneratedCard[], seen: GenerateInput[] = []) {
  return Object.assign(new MockAgent(), { generateCards: async (input: GenerateInput) => { seen.push(input); return cards(input) } })
}

test('while authoring, generated cards fill the requester\'s quota as composited agent cards', async t => {
  // Hold the agent until the in-flight state has been checked.
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const mock = new MockAgent()
  const { rooms, room, a, b } = await setup(t, Object.assign(mock, { generateCards: async (input: GenerateInput) => { await gate; return MockAgent.prototype.generateCards.call(mock, input) } }))
  await rooms.handle(a.connection, { type: 'submitCard', card: { title: 'Mine', text: 'my own card', art } })
  await assert.rejects(rooms.handle(a.connection, { type: 'generateCards', count: 2 }), /left to make/)
  await rooms.handle(a.connection, { type: 'generateCards', count: 1 })
  assert.deepEqual(rooms.view(room, a.connection.playerId!).generating, { playerId: a.connection.playerId, count: 1 })
  await assert.rejects(rooms.handle(b.connection, { type: 'generateCards', count: 1 }), /already/)
  release()
  await settle(room)
  const mine = room.cards.filter(c => c.authorId === a.connection.playerId)
  assert.equal(mine.length, 2)
  const written = mine.find(c => c.byAgent)!
  assert.ok(written.text && written.title)
  const image = await loadImage(Buffer.from(written.png.slice('data:image/png;base64,'.length), 'base64'))
  assert.deepEqual([image.width, image.height], [config.card.widthPx, config.card.heightPx])
  const view = rooms.view(room, a.connection.playerId!)
  assert.equal(view.generating, null)
  assert.equal(view.generateRemaining, config.generate.maxPerRoom - 1)
  assert.equal(view.myCards.length, 2)
  // Private until the deal: Bo can't see Ana's new card.
  assert.equal(rooms.image(room.code, written.id, room.seats[1].token), null)
  assert.match(JSON.stringify(room.thread.at(-1)), /drew 1 card for Ana/)
})

test('the agent sees the built-in examples, the room\'s cards, and mid-game rules', async t => {
  const seen: GenerateInput[] = []
  const { rooms, room, a, b } = await setup(t, writer(input => Array.from({ length: input.count }, (_, i) => ({ title: `New ${i}`, text: `new card ${i} ${seen.length}`, doodle: [] })), seen))
  await rooms.handle(a.connection, { type: 'submitCard', card: { title: 'Mine', text: 'a card by Ana', art } })
  await rooms.handle(a.connection, { type: 'generateCards', count: 1 })
  await settle(room)
  assert.equal(seen[0].count, 1)
  assert.deepEqual(seen[0].limits, { titleMaxChars: config.card.titleMaxChars, maxChars: config.card.maxChars })
  assert.deepEqual(seen[0].examples.slice(0, EXAMPLE_CARDS.length).map(e => e.text), EXAMPLE_CARDS.map(e => e.text))
  assert.deepEqual(seen[0].existing.map(c => c.text), ['a card by Ana'])
  assert.equal(seen[0].rules, null)
  for (let i = 0; i < 2; i++) await rooms.handle(b.connection, { type: 'submitCard', card: { text: `bo ${i}`, art } })
  await rooms.handle(a.connection, { type: 'startGame' })
  const deck = room.state!.deck.length
  await rooms.handle(b.connection, { type: 'generateCards', count: 2 })
  await settle(room)
  assert.equal(seen[1].rules?.targetScore, 10)
  assert.equal(seen[1].existing.length, 4)
  assert.equal(room.state!.deck.length, deck + 2)
  assert.equal(new Set([...room.state!.deck, ...room.state!.players.flatMap(p => p.hand)]).size, 6)
  assert.match(JSON.stringify(room.thread.at(-1)), /shuffled them into the deck/)
})

test('cards that are too long or repeat existing ones are dropped; none left is an error', async t => {
  const long = 'x'.repeat(config.card.maxChars + 1)
  let batch: GeneratedCard[] = [
    { title: 'A title that is far too long to fit on a card', text: 'fine text', doodle: [[0, 0, 100, 100]] },
    { title: 'Long', text: long, doodle: [] },
    { title: 'Copy', text: 'Fine text', doodle: [] },
  ]
  const { rooms, room, a } = await setup(t, writer(() => batch))
  await rooms.handle(a.connection, { type: 'generateCards', count: 2 })
  await settle(room)
  assert.equal(room.cards.length, 1)
  assert.match(JSON.stringify(room.thread), /Only 1 of 2 requested cards/)
  assert.equal(room.cards[0].title, 'A title that is far too long to fit on a card'.slice(0, config.card.titleMaxChars).trim())
  batch = [{ title: 'Long', text: long, doodle: [] }]
  a.messages.length = 0
  await rooms.handle(a.connection, { type: 'generateCards', count: 1 })
  await settle(room)
  assert.equal(room.cards.length, 1)
  assert.equal(room.generating, null)
  assert.ok(a.messages.some(m => m.type === 'error' && /couldn't write cards/.test(m.message)))
})

test('a game that ran out of cards comes back to life with generated cards', async t => {
  const { rooms, room, a, b } = await setup(t, new MockAgent(() => ({ narration: 'One point.', effects: [{ kind: 'score', amount: 1 }], rulesPatch: {} })), { cardsPerPlayer: 1, handSize: 1, targetScore: 50 })
  for (const p of [a, b]) await rooms.handle(p.connection, { type: 'submitCard', card: { text: 'one', art } })
  await rooms.handle(a.connection, { type: 'startGame' })
  for (let i = 0; i < 2; i++) {
    const current = room.state!.turn.playerId === a.connection.playerId ? a : b
    await rooms.handle(current.connection, { type: 'playCard', cardId: room.state!.players.find(p => p.id === current.connection.playerId)!.hand[0] })
  }
  assert.equal(room.phase, 'ended')
  assert.equal(room.state!.winnerId, null)
  await rooms.handle(b.connection, { type: 'generateCards', count: 2 })
  await settle(room)
  assert.equal(room.phase, 'play')
  assert.deepEqual(room.state!.players.map(p => p.hand.length), [1, 1])
  assert.equal(rooms.view(room, a.connection.playerId!).gameCards.length, 0)
  const current = room.state!.turn.playerId === a.connection.playerId ? a : b
  await rooms.handle(current.connection, { type: 'playCard', cardId: room.state!.players.find(p => p.id === current.connection.playerId)!.hand[0] })
  assert.equal(room.state!.discard.length, 3)
})

test('request limits: per request, per room, finished games, and agents that cannot write', async t => {
  const { rooms, room, a } = await setup(t, new MockAgent(), { cardsPerPlayer: 8, handSize: 1, targetScore: 10 })
  await assert.rejects(rooms.handle(a.connection, { type: 'generateCards', count: config.generate.maxPerRequest + 1 }), /at most/)
  room.generated = config.generate.maxPerRoom
  await assert.rejects(rooms.handle(a.connection, { type: 'generateCards', count: 1 }), /all the cards/)
  const other = await setup(t, { interpret: new MockAgent().interpret })
  await assert.rejects(other.rooms.handle(other.a.connection, { type: 'generateCards', count: 1 }), /cannot write/)
  const won = await setup(t)
  for (const p of [won.a, won.b]) for (let i = 0; i < 2; i++) await won.rooms.handle(p.connection, { type: 'submitCard', card: { text: '+10 points', art } })
  await won.rooms.handle(won.a.connection, { type: 'startGame' })
  const current = won.room.state!.turn.playerId === won.a.connection.playerId ? won.a : won.b
  await won.rooms.handle(current.connection, { type: 'playCard', cardId: won.room.state!.players.find(p => p.id === current.connection.playerId)!.hand[0] })
  assert.ok(won.room.state!.winnerId)
  await assert.rejects(won.rooms.handle(won.a.connection, { type: 'generateCards', count: 1 }), /over/)
})

test('generated cards and the room\'s running total survive a restart', async t => {
  const { rooms, room, a, directory } = await setup(t)
  await rooms.handle(a.connection, { type: 'generateCards', count: 2 })
  await settle(room)
  const reloaded = new Rooms(config, directory, new MockAgent())
  await reloaded.load()
  const again = reloaded.rooms.get(room.code)!
  assert.equal(again.generated, 2)
  assert.equal(again.generating, null)
  assert.equal(again.cards.filter(c => c.byAgent).length, 2)
})

test('doodles render as black ink on white', async () => {
  const blank = await loadImage(Buffer.from(renderDoodle([], config.card).split(',')[1], 'base64'))
  const drawn = await loadImage(Buffer.from(renderDoodle([[0, 50, 100, 50]], config.card).split(',')[1], 'base64'))
  const ink = (image: typeof blank) => {
    const c = createCanvas(image.width, image.height), ctx = c.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return ctx.getImageData(0, 0, c.width, c.height).data.filter((v, i) => i % 4 === 0 && v === 0).length
  }
  assert.equal(ink(blank), 0)
  assert.ok(ink(drawn) > 1000)
})

test('generation deadline cancels the writer, clears pending, ignores late cards and allows retry', async t => {
  let signal: AbortSignal | undefined
  let finish!: (cards: GeneratedCard[]) => void
  let calls = 0
  const agent = Object.assign(new MockAgent(), { generateCards: async (_input: GenerateInput, cancellation?: AbortSignal) => {
    calls++
    signal = cancellation
    if (calls === 1) return new Promise<GeneratedCard[]>(resolve => { finish = resolve })
    return [{ title: 'Retry', text: 'retry works', doodle: [] }]
  } })
  const { rooms, room, a } = await setup(t, agent)
  room.config.agent.timeoutMs = 30
  await rooms.handle(a.connection, { type: 'generateCards', count: 1 })
  await settle(room)
  assert.equal(signal?.aborted, true)
  assert.equal(room.generating, null)
  assert.equal(room.cards.length, 0)
  assert.ok(a.messages.some(m => m.type === 'error' && /took too long/.test(m.message)))
  await rooms.handle(a.connection, { type: 'generateCards', count: 1 })
  await settle(room)
  finish([{ title: 'Late', text: 'must not arrive', doodle: [] }])
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(room.cards.map(c => c.text), ['retry works'])
  assert.equal(room.generated, 1)
})
