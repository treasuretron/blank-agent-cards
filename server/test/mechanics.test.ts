import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { GameConfigSchema, baseRules, type AgentInput, type GameState, type Play } from '@cards/shared'
import { loadMechanics, mechanics } from '../src/mechanics.ts'
import { runEngine } from '../src/engineHost.ts'
import { Rooms, type Peer } from '../src/rooms.ts'
import { MockAgent } from '../src/agent/mock.ts'

// The snippets are plain JS for the sandbox; load them untyped for direct unit tests.
const snippet = (file: string): Promise<any> => import(new URL(`../../game/mechanics/${file}`, import.meta.url).href)
const [points, cards, turns, lookups] = await Promise.all(['points.mjs', 'cards.mjs', 'turns.mjs', 'state.mjs'].map(snippet))

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
const baseSource = await readFile(new URL('../../game/engine.mjs', import.meta.url), 'utf8')

function state(): GameState {
  return {
    players: [{ id: 'a', name: 'Ana', score: 10, hand: ['c1', 'c2'] }, { id: 'b', name: 'Bo', score: 3, hand: ['c3'] }, { id: 'c', name: 'Cy', score: 0, hand: ['c4'] }],
    deck: ['d1', 'd2'], discard: [], turn: { playerId: 'a', number: 1, playsThisTurn: 0 }, rules: baseRules(100, 2), vars: {}, winnerId: null,
  }
}
const cardIds = (s: GameState) => [...s.deck, ...s.discard, ...s.players.flatMap(p => p.hand)].sort()

test('the library loads, every export is documented, and names are unique', () => {
  assert.ok(mechanics.names.length >= 20)
  assert.equal(new Set(mechanics.names).size, mechanics.names.length)
  for (const name of mechanics.names) assert.match(mechanics.catalog, new RegExp(`^${name}\\(`, 'm'))
})

test('the loader refuses undocumented, duplicated, or importing snippets', async t => {
  const dir = await mkdtemp('/tmp/opencode/mechanics-test-')
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(`${dir}/a.mjs`, 'export function bare() {}\n')
  assert.throws(() => loadMechanics(dir), /needs a "\/\/ bare\(/)
  await writeFile(`${dir}/a.mjs`, '// one() → x\nexport function one() {}\n')
  await writeFile(`${dir}/b.mjs`, '// one() → x\nexport function one() {}\n')
  assert.throws(() => loadMechanics(dir), /exported by both a.mjs and b.mjs/)
  await writeFile(`${dir}/b.mjs`, "import fs from 'node:fs'\n// two() → x\nexport function two() {}\n")
  assert.throws(() => loadMechanics(dir), /must not import/)
})

test('point snippets', () => {
  const s = state()
  assert.deepEqual(points.stealPoints(s, 'b', 'a', 5), [{ text: 'Ana steals 3 points from Bo' }])
  assert.deepEqual([s.players[0].score, s.players[1].score], [13, 0])
  points.addPointsToAll(s, 2, 'a')
  assert.deepEqual(s.players.map(p => p.score), [13, 2, 2])
  points.swapScores(s, 'a', 'c')
  assert.deepEqual(s.players.map(p => p.score), [2, 2, 13])
  assert.throws(() => points.addPoints(s, 'zz', 1), /Unknown player/)
  assert.throws(() => points.stealPoints(s, 'a', 'b', -1), /non-negative/)
})

test('card snippets never lose or invent cards', () => {
  const s = state(), before = cardIds(s)
  cards.drawCards(s, 'b', 5)
  assert.deepEqual(s.players[1].hand, ['c3', 'd1', 'd2'])
  cards.discardRandom(s, 'b', 2)
  cards.giveRandomCard(s, 'a', 'c')
  cards.swapHands(s, 'a', 'b')
  cards.recycleDiscard(s)
  assert.equal(s.discard.length, 0)
  assert.deepEqual(cardIds(s), before)
})

test('turn snippets honour direction, skips, extra turns and empty hands', () => {
  const s = state()
  assert.equal(turns.playerAfter(s, 'a').id, 'b')
  turns.reverseDirection(s)
  assert.equal(turns.playerAfter(s, 'a').id, 'c')
  turns.reverseDirection(s)
  turns.skipNextTurns(s, 'b')
  assert.deepEqual(turns.advanceTurn(s, 'a'), [{ text: 'Bo misses a turn' }])
  assert.equal(s.turn.playerId, 'c')
  turns.extraTurn(s, 'c')
  turns.advanceTurn(s, 'c')
  assert.equal(s.turn.playerId, 'c')
  s.players[0].hand = []
  turns.advanceTurn(s, 'c')
  assert.equal(s.turn.playerId, 'b')
  assert.equal(s.turn.number, 4)
})

test('lookup and timed-effect snippets', () => {
  const s = state()
  assert.equal(lookups.leader(s)?.id, 'a')
  assert.equal(lookups.lastPlace(s)?.id, 'c')
  s.players[2].score = 3
  assert.equal(lookups.lastPlace(s), null)
  assert.notEqual(lookups.randomOpponent(s, 'a')?.id, 'a')
  assert.equal(lookups.addCounter(s, 'cats'), 1)
  assert.equal(lookups.addCounter(s, 'cats', 2), 3)
  lookups.addTimedEffect(s, { kind: 'double-points' }, 2)
  assert.equal(lookups.activeTimedEffects(s, 'double-points').length, 1)
  assert.deepEqual(lookups.tickTimedEffects(s), [])
  assert.deepEqual(lookups.tickTimedEffects(s), [{ text: 'double-points wears off' }])
  assert.equal(lookups.activeTimedEffects(s).length, 0)
})

// A generated-style engine that leans on the library for a brand-new "steal" effect.
const stealEngine = baseSource
  .replace("export const meta = { version: 1 }", "import { stealPoints } from 'mechanics'\nimport { advanceTurn } from 'mechanics/turns'\nexport const meta = { version: 2 }")
  .replace("    } else throw new Error(`Unknown effect: ${effect.kind}`)", "    } else if (effect.kind === 'steal') {\n      events.push(...stealPoints(state, effect.target, play.playerId, effect.amount))\n    } else throw new Error(`Unknown effect: ${effect.kind}`)")

test('sandboxed engines can import the library, and nothing else', async () => {
  assert.notEqual(stealEngine, baseSource)
  const play: Play = { playerId: 'a', card: { id: 'c1', authorId: 'a', text: 'Steal 2 from Bo' }, effects: [{ kind: 'steal', target: 'b', amount: 2 }] }
  const result = await runEngine(stealEngine, state(), play, 5000)
  assert.equal(result.version, 2)
  assert.deepEqual(result.result!.state.players.map(p => p.score), [12, 1, 0])
  assert.ok(result.result!.events.some(e => e.text === 'Ana steals 2 points from Bo'))
  for (const bad of ["import fs from 'node:fs'", "import x from 'mechanics/../engine'", "import x from 'mechanics/nope'", "import x from './mechanics/points.mjs'"]) {
    await assert.rejects(runEngine(`${bad}\n${baseSource}`, state(), play, 5000), /imports are forbidden/, bad)
  }
})

test('in a real room the agent sees the catalog, and an engine that imports snippets persists across plays', async t => {
  const directory = await mkdtemp('/tmp/opencode/cards-mechanics-test-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const inputs: AgentInput[] = []
  const agent = new MockAgent(input => {
    inputs.push(input)
    return inputs.length === 1
      ? { narration: 'A thief!', effects: [], rulesPatch: {}, enginePatch: stealEngine }
      : { narration: 'Steal again', effects: [{ kind: 'steal', target: Object.keys(input.playerNames).find(id => id !== input.playerId)!, amount: 0 }], rulesPatch: {} }
  })
  const rooms = new Rooms(config, directory, agent)
  await rooms.load()
  const peers = [{ send: () => {} }, { send: () => {} }] as Peer[]
  await rooms.handle(peers[0], { type: 'createRoom', name: 'Ana', configOverrides: { cardsPerPlayer: 2, handSize: 2 } })
  const room = peers[0].room!
  await rooms.handle(peers[1], { type: 'joinRoom', code: room.code, name: 'Bo' })
  const canvas = createCanvas(10, 10)
  for (const p of peers) for (let i = 0; i < 2; i++) await rooms.handle(p, { type: 'submitCard', card: { text: `card ${p === peers[0] ? 'a' : 'b'}${i}`, art: canvas.toDataURL('image/png') } })
  await rooms.handle(peers[0], { type: 'startGame' })
  for (let i = 0; i < 2; i++) {
    const current = peers.find(p => p.playerId === room.state!.turn.playerId)!
    await rooms.handle(current, { type: 'playCard', cardId: room.state!.players.find(p => p.id === current.playerId)!.hand[0] })
  }
  assert.equal(inputs[0].mechanics, mechanics.catalog)
  assert.equal(room.version, 2)
  assert.match(room.source, /from 'mechanics'/)
  const verdicts = room.thread.filter(e => e.kind === 'verdict')
  assert.deepEqual(verdicts.map(v => v.kind === 'verdict' && v.engineError), [undefined, undefined])
  assert.ok(verdicts[1].kind === 'verdict' && verdicts[1].events.some(e => /steals 0 points/.test(e)))
})
