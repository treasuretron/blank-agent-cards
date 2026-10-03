import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import WebSocket from 'ws'

const origin = 'http://127.0.0.1:8080'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function healthy() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(origin + '/health')).ok) return } catch {}
    await sleep(200)
  }
  throw new Error('Game health deadline')
}
async function client() {
  const socket = new WebSocket('ws://127.0.0.1:8080/ws', { origin })
  const messages = []
  socket.on('message', data => messages.push(JSON.parse(data)))
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  return { socket, send: value => socket.send(JSON.stringify(value)), async wait(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const index = messages.findIndex(predicate)
      if (index >= 0) return messages.splice(index, 1)[0]
      await sleep(50)
    }
    throw new Error('Websocket message deadline')
  } }
}
function restart() {
  assert.equal(spawnSync('systemctl', ['restart', 'cards-game']).status, 0)
}
assert.equal(process.getuid(), 0, 'Run with sudo; verification restarts only cards-game')
await healthy()
assert.equal((await fetch(origin)).status, 200)
const denied = new WebSocket('ws://127.0.0.1:8080/ws', { origin: 'https://evil.example' })
await new Promise((resolve, reject) => {
  denied.on('unexpected-response', (_, response) => { assert.equal(response.statusCode, 401); response.resume(); denied.terminate(); resolve() })
  denied.on('error', () => {})
  denied.on('open', () => reject(new Error('Foreign origin accepted')))
})
const host = await client()
let code
const clients = [host]
try {
  host.send({ type: 'createRoom', name: 'M5 verification', configOverrides: { maxPlayers: 999 } })
  assert.match((await host.wait(m => m.type === 'error')).message, /limit/i)
  host.send({ type: 'createRoom', name: 'M5 verification', configOverrides: { cardsPerPlayer: 1, handSize: 1 } })
  const seat = await host.wait(m => m.type === 'joined'); code = seat.code
  host.send({ type: 'say', text: 'M5 restart marker' })
  await host.wait(m => m.type === 'state' && m.snapshot.thread.some(e => e.text === 'M5 restart marker'))
  host.socket.terminate()
  restart(); await healthy()
  const resumed = await client(); clients.push(resumed)
  resumed.send({ type: 'resume', code, token: seat.token })
  assert.equal((await resumed.wait(m => m.type === 'joined')).playerId, seat.playerId)
  const state = (await resumed.wait(m => m.type === 'state')).snapshot
  assert.equal(state.players.length, 1)
  assert.ok(state.thread.some(e => e.text === 'M5 restart marker'))
  const invalid = await client(); clients.push(invalid)
  invalid.send({ type: 'resume', code, token: 'x'.repeat(43) })
  assert.match((await invalid.wait(m => m.type === 'error')).message, /Invalid/)
  const { createCanvas } = await import('../server/node_modules/@napi-rs/canvas/index.js')
  const canvas = createCanvas(480, 480), context = canvas.getContext('2d')
  context.fillStyle = 'white'; context.fillRect(0, 0, 480, 480)
  resumed.send({ type: 'submitCard', card: { text: '10 points', art: canvas.toDataURL('image/png') } })
  const cardState = (await resumed.wait(m => m.type === 'state' && m.snapshot.myCards.length === 1)).snapshot
  const image = cardState.myCards[0].imageUrl
  assert.equal((await fetch(origin + image)).status, 200)
  assert.equal((await fetch(origin + image.split('?')[0])).status, 404)
  const guest = await client(); clients.push(guest)
  guest.send({ type: 'joinRoom', code, name: 'M5 guest' })
  const guestSeat = await guest.wait(m => m.type === 'joined')
  guest.send({ type: 'submitCard', card: { text: '10 points', art: canvas.toDataURL('image/png') } })
  await guest.wait(m => m.type === 'state' && m.snapshot.myCards.length === 1)
  resumed.send({ type: 'startGame' })
  const hostPlay = (await resumed.wait(m => m.type === 'state' && m.snapshot.phase === 'play')).snapshot
  const guestPlay = (await guest.wait(m => m.type === 'state' && m.snapshot.phase === 'play')).snapshot
  const acting = hostPlay.turn.playerId === seat.playerId ? resumed : guest
  const actingState = acting === resumed ? hostPlay : guestPlay
  acting.send({ type: 'playCard', cardId: actingState.hand[0].id })
  const afterPlay = (await resumed.wait(m => m.type === 'state' && !m.snapshot.agentPending && m.snapshot.players.some(p => p.score === 10))).snapshot
  assert.equal(afterPlay.engineVersion, 1)
  guest.socket.terminate()
  resumed.socket.terminate(); restart(); await healthy()
  const again = await client(); clients.push(again)
  again.send({ type: 'resume', code, token: seat.token })
  const restored = (await again.wait(m => m.type === 'state')).snapshot
  assert.deepEqual(restored.hand, afterPlay.hand)
  assert.deepEqual(restored.turn, afterPlay.turn)
  assert.deepEqual(restored.players.map(p => p.score), afterPlay.players.map(p => p.score))
  assert.equal(restored.thread.length, afterPlay.thread.length)
  const visibleCard = restored.hand[0] ?? restored.thread.find(e => e.kind === 'play').card
  assert.equal((await fetch(origin + visibleCard.imageUrl)).status, 200)
  assert.ok(guestSeat.token)
  const flood = await client(); clients.push(flood)
  for (let n = 0; n < 30; n++) flood.send({ type: 'say', text: 'bounded' })
  await new Promise((resolve, reject) => { flood.socket.once('close', value => { assert.equal(value, 1008); resolve() }); setTimeout(() => reject(new Error('Flood not closed')), 3000).unref() })
  console.log('PASS: frontend, health, origin/config/message limits, seat auth, restart/chat/card persistence, protected images')
} finally {
  for (const c of clients) c.socket.terminate()
  if (code) {
    assert.equal(spawnSync('systemctl', ['stop', 'cards-game']).status, 0)
    await rm(`/var/lib/cards-game/rooms/${code}.json`, { force: true })
    restart(); await healthy()
  }
}
