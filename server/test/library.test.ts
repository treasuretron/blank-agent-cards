import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { GameConfigSchema, SavedCardMetaSchema, savedCardName, slugify, type ServerMsg } from '@cards/shared'
import { Rooms, type Peer } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'
import { createGameServer } from '../src/index.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const canvas = createCanvas(20, 20)
canvas.getContext('2d').fillRect(0, 0, 20, 20)
const art = canvas.toDataURL('image/png')
const overrides = { cardsPerPlayer: 2, handSize: 1, targetScore: 10 }

function peer() {
  const messages: ServerMsg[] = []
  const connection: Peer = { send: message => messages.push(message) }
  return { connection, messages }
}
async function newRoom(rooms: Rooms) {
  const a = peer(), b = peer()
  await rooms.handle(a.connection, { type: 'createRoom', name: 'Ana', configOverrides: overrides })
  await rooms.handle(b.connection, { type: 'joinRoom', code: a.connection.room!.code, name: 'Bo' })
  return { room: a.connection.room!, a, b }
}
async function finishedGame(rooms: Rooms) {
  const game = await newRoom(rooms)
  for (const [p, name] of [[game.a, 'a'], [game.b, 'b']] as const) for (let i = 0; i < 2; i++) await rooms.handle(p.connection, { type: 'submitCard', card: { title: `Card ${name}${i}`, text: `${name}${i}`, art } })
  await rooms.handle(game.a.connection, { type: 'startGame' })
  const current = game.room.state!.turn.playerId === game.a.connection.playerId ? game.a : game.b
  await assert.rejects(rooms.handle(current.connection, { type: 'saveCards', cardIds: [game.room.cards[0].id] }), /over/)
  await rooms.handle(current.connection, { type: 'playCard', cardId: game.room.state!.players.find(p => p.id === current.connection.playerId)!.hand[0] })
  assert.equal(game.room.phase, 'ended')
  return game
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp('/tmp/opencode/cards-library-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rooms = new Rooms(config, directory, new MockAgent())
  await rooms.load()
  return { rooms, directory }
}

test('saved card names follow the <slug>--<id> convention', () => {
  assert.equal(slugify('  Steal ALL the points!! '), 'steal-all-the-points')
  assert.equal(slugify(undefined), 'untitled')
  assert.equal(slugify('!!!'), 'untitled')
  assert.equal(savedCardName({ id: '0d4c1a62-0000-4000-8000-000000000000', title: 'Hi' }), 'hi--0d4c1a62-0000-4000-8000-000000000000')
})

test('ended game reveals every card and saves chosen ones to the server library as png+json pairs', async t => {
  const { rooms, directory } = await setup(t)
  const { room, a, b } = await finishedGame(rooms)
  const view = rooms.view(room, a.connection.playerId!)
  assert.equal(view.gameCards.length, 4)
  // Unplayed cards from the other player's hand are viewable once the game is over.
  for (const card of view.gameCards) assert.ok(rooms.image(room.code, card.id, room.seats[0].token))

  const chosen = view.gameCards.filter(c => c.authorId === b.connection.playerId).map(c => c.id)
  await rooms.handle(a.connection, { type: 'saveCards', cardIds: chosen })
  const saved = a.messages.at(-1)
  assert.equal(saved?.type, 'cardsSaved')
  const names = saved.type === 'cardsSaved' ? saved.names : []
  assert.deepEqual(names.sort(), chosen.map(id => savedCardName(room.cards.find(c => c.id === id)!)).sort())
  const files = (await readdir(path.join(directory, 'library'))).sort()
  assert.deepEqual(files, names.flatMap(n => [`${n}.json`, `${n}.png`]).sort())
  const meta = SavedCardMetaSchema.parse(JSON.parse(await readFile(path.join(directory, 'library', `${names[0]}.json`), 'utf8')))
  assert.equal(meta.authorName, 'Bo'); assert.equal(meta.gameCode, room.code)

  // Saving again is idempotent; unknown cards are rejected.
  await rooms.handle(b.connection, { type: 'saveCards', cardIds: chosen })
  assert.equal((await readdir(path.join(directory, 'library'))).length, 4)
  await assert.rejects(rooms.handle(a.connection, { type: 'saveCards', cardIds: ['nope'] }), /Unknown/)

  await rooms.handle(a.connection, { type: 'listLibrary' })
  const listed = a.messages.at(-1)
  assert.equal(listed?.type, 'library')
  assert.equal(listed.type === 'library' && listed.cards.length, 2)
  assert.ok(await rooms.libraryImage(room.code, names[0], room.seats[0].token))
  assert.equal(await rooms.libraryImage(room.code, names[0], 'bad'), null)
  assert.equal(await rooms.libraryImage(room.code, '../../etc--passwd', room.seats[0].token), null)
})

test('saved cards import into a new game from the library or a local file pair, within quota', async t => {
  const { rooms, directory } = await setup(t)
  const first = await finishedGame(rooms)
  await rooms.handle(first.a.connection, { type: 'saveCards', cardIds: first.room.cards.map(c => c.id) })
  const names = (first.a.messages.at(-1) as Extract<ServerMsg, { type: 'cardsSaved' }>).names

  const { room, a } = await newRoom(rooms)
  await rooms.handle(a.connection, { type: 'importLibraryCard', name: names[0] })
  const imported = rooms.view(room, a.connection.playerId!).myCards
  const original = first.room.cards.find(c => savedCardName(c) === names[0])!
  assert.equal(imported.length, 1)
  assert.equal(imported[0].title, original.title); assert.equal(imported[0].text, original.text)
  assert.equal(room.cards[0].png, original.png)
  assert.notEqual(imported[0].id, original.id)
  await assert.rejects(rooms.handle(a.connection, { type: 'importLibraryCard', name: names[0] }), /already/)
  await assert.rejects(rooms.handle(a.connection, { type: 'importLibraryCard', name: `missing--${original.id}` }), /not found/)

  // A locally downloaded pair: the .png as a data URL plus the parsed .json.
  const png = `data:image/png;base64,${(await readFile(path.join(directory, 'library', `${names[1]}.png`))).toString('base64')}`
  const meta = SavedCardMetaSchema.parse(JSON.parse(await readFile(path.join(directory, 'library', `${names[1]}.json`), 'utf8')))
  await assert.rejects(rooms.handle(a.connection, { type: 'importCard', png: art, meta }), /must be 480x720/)
  await assert.rejects(rooms.handle(a.connection, { type: 'importCard', png, meta: { ...meta, text: 'x'.repeat(config.card.maxChars + 1) } }), /longer/)
  await rooms.handle(a.connection, { type: 'importCard', png, meta })
  assert.equal(rooms.view(room, a.connection.playerId!).myCards.length, 2)
  await assert.rejects(rooms.handle(a.connection, { type: 'importLibraryCard', name: names[2] }), /quota/)
})

test('library images are served over HTTP to seated players only', async t => {
  const { rooms } = await setup(t)
  const { room, a } = await finishedGame(rooms)
  await rooms.handle(a.connection, { type: 'saveCards', cardIds: [room.cards[0].id] })
  const [name] = (a.messages.at(-1) as Extract<ServerMsg, { type: 'cardsSaved' }>).names
  const app = await createGameServer({ config, directory: rooms.directory, rooms })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => { app.ws.close(); app.server.close(() => resolve()) }))
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/rooms/${room.code}/library/${name}`
  const ok = await fetch(`${base}?token=${encodeURIComponent(room.seats[0].token)}`)
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.equal((await fetch(`${base}?token=bad`)).status, 404)
})
