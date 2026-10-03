import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm, readFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { createHmac } from 'node:crypto'

const origin = 'http://127.0.0.1:8080'
const password = (await readFile('/etc/cards/initial-password', 'utf8')).trim()
const login = await fetch(origin + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) })
assert.equal(login.status, 303)
const cookie = login.headers.get('set-cookie').split(';')[0]
assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/)
const authorized = (path, options = {}) => fetch(origin + path, { ...options, headers: { Cookie: cookie, ...options.headers } })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function healthy() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await authorized('/health')).ok) return } catch {}
    await sleep(200)
  }
  throw new Error('Game health deadline')
}
async function client() {
  const socket = new WebSocket('ws://127.0.0.1:8080/ws', { origin, headers: { Cookie: cookie } })
  const messages = []
  socket.on('message', data => messages.push(JSON.parse(data)))
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  return { socket, send: value => socket.send(JSON.stringify(value)), async wait(predicate) {
    for (let attempt = 0; attempt < 4000; attempt++) {
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
assert.equal((await authorized('/')).status, 200)
for (const path of ['/health', '/rooms/ABCD/cards/123', '/_next/static/test.js']) assert.equal((await fetch(origin + path)).status, 401)
assert.equal((await fetch(origin + '/health', { headers: { Cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') } })).status, 401)
const auth = JSON.parse(await readFile('/etc/cards/gateway.json', 'utf8'))
const expired = `${Math.floor(Date.now() / 1000) - 1}.${'a'.repeat(22)}`
assert.equal((await fetch(origin + '/health', { headers: { Cookie: `__Host-cards_session=${expired}.${createHmac('sha256', auth.sessionKey).update(expired).digest('base64url')}` } })).status, 401)
assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' })).status, 401)
assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' })).status, 403)
for (const options of [{ origin }, { origin: 'https://evil.example', headers: { Cookie: cookie } }, { headers: { Cookie: cookie } }]) {
 const denied = new WebSocket('ws://127.0.0.1:8080/ws', options)
 await new Promise((resolve, reject) => {
  denied.on('unexpected-response', (_, response) => { assert.equal(response.statusCode, 401); response.resume(); denied.terminate(); resolve() })
  denied.on('error', () => {})
  denied.on('open', () => reject(new Error('Foreign origin accepted')))
 })
}
const host = await client()
let code
const clients = [host]
try {
  host.send({ type: 'createRoom', name: 'M5 verification', configOverrides: { maxPlayers: 999 } })
  assert.match((await host.wait(m => m.type === 'error')).message, /limit/i)
  host.send({ type: 'createRoom', name: 'M5 verification', configOverrides: { cardsPerPlayer: 2, handSize: 2 } })
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
  resumed.send({ type: 'submitCard', card: { text: '10 points', art: canvas.toDataURL('image/png') } })
  await resumed.wait(m => m.type === 'state' && m.snapshot.myCards.length === 2)
  const image = cardState.myCards[0].imageUrl
   assert.equal((await fetch(origin + image)).status, 401)
   assert.equal((await authorized(image)).status, 200)
   assert.equal((await authorized(image.split('?')[0])).status, 404)
  const guest = await client(); clients.push(guest)
  guest.send({ type: 'joinRoom', code, name: 'M5 guest' })
  const guestSeat = await guest.wait(m => m.type === 'joined')
  guest.send({ type: 'submitCard', card: { text: '10 points', art: canvas.toDataURL('image/png') } })
  await guest.wait(m => m.type === 'state' && m.snapshot.myCards.length === 1)
  guest.send({ type: 'submitCard', card: { text: '10 points', art: canvas.toDataURL('image/png') } })
  await guest.wait(m => m.type === 'state' && m.snapshot.myCards.length === 2)
  resumed.send({ type: 'startGame' })
  const hostPlay = (await resumed.wait(m => m.type === 'state' && m.snapshot.phase === 'play')).snapshot
  const guestPlay = (await guest.wait(m => m.type === 'state' && m.snapshot.phase === 'play')).snapshot
  const acting = hostPlay.turn.playerId === seat.playerId ? resumed : guest
  const actingState = acting === resumed ? hostPlay : guestPlay
  acting.send({ type: 'playCard', cardId: actingState.hand[0].id })
  const afterPlay = (await resumed.wait(m => m.type === 'state' && !m.snapshot.agentPending && m.snapshot.players.some(p => p.score === 10))).snapshot
   assert.equal(afterPlay.engineVersion, 1)
   const verdict = afterPlay.thread.filter(e => e.kind === 'verdict').at(-1)
   assert.equal(verdict.engineError, undefined)
   assert.ok(verdict.verdict.effects.length)
   const persisted = JSON.parse(await readFile(`/var/lib/cards-game/rooms/${code}.json`, 'utf8'))
   assert.equal(persisted.config.agent.provider, 'opencode')
   assert.equal(persisted.config.agent.model, 'opencode/space-bunny-free')
   const other = acting === resumed ? guest : resumed
    const otherState = other === resumed ? afterPlay : (await other.wait(m => m.type === 'state' && !m.snapshot.agentPending && m.snapshot.players.some(p => p.score === 10))).snapshot
   other.send({ type: 'playCard', cardId: otherState.hand[0].id })
   const finalPlay = (await resumed.wait(m => m.type === 'state' && !m.snapshot.agentPending && m.snapshot.thread.filter(e => e.kind === 'verdict').length === 2)).snapshot
   assert.ok(finalPlay.thread.filter(e => e.kind === 'verdict').every(e => !e.engineError))
  guest.socket.terminate()
  resumed.socket.terminate(); restart(); await healthy()
  const again = await client(); clients.push(again)
  again.send({ type: 'resume', code, token: seat.token })
  const restored = (await again.wait(m => m.type === 'state')).snapshot
   assert.deepEqual(restored.hand, finalPlay.hand)
   assert.deepEqual(restored.turn, finalPlay.turn)
   assert.deepEqual(restored.players.map(p => p.score), finalPlay.players.map(p => p.score))
   assert.equal(restored.thread.length, finalPlay.thread.length)
  const visibleCard = restored.hand[0] ?? restored.thread.find(e => e.kind === 'play').card
   assert.equal((await authorized(visibleCard.imageUrl)).status, 200)
   assert.ok(guestSeat.token)
   const guestAgain = await client(); clients.push(guestAgain)
   guestAgain.send({ type: 'resume', code, token: guestSeat.token })
   const guestRestored = (await guestAgain.wait(m => m.type === 'state')).snapshot
   const next = restored.turn.playerId === seat.playerId ? again : guestAgain
   const nextState = next === again ? restored : guestRestored
   next.send({ type: 'playCard', cardId: nextState.hand[0].id })
   await again.wait(m => m.type === 'state' && m.snapshot.agentPending)
   again.socket.terminate(); guestAgain.socket.terminate()
   restart(); await healthy()
   assert.equal(spawnSync('systemctl', ['restart', 'cards-preview']).status, 0)
   await healthy()
   const recovered = await client(); clients.push(recovered)
   recovered.send({ type: 'resume', code, token: seat.token })
   const recovery = (await recovered.wait(m => m.type === 'state')).snapshot
   assert.equal(recovery.agentPending, false)
   assert.ok(recovery.thread.filter(e => e.kind === 'verdict').at(-1).engineError)
   assert.deepEqual(recovery.players.map(p => p.score), finalPlay.players.map(p => p.score))
  const flood = await client(); clients.push(flood)
  for (let n = 0; n < 30; n++) flood.send({ type: 'say', text: 'bounded' })
  await new Promise((resolve, reject) => { flood.socket.once('close', value => { assert.equal(value, 1008); resolve() }); setTimeout(() => reject(new Error('Flood not closed')), 3000).unref() })
   const logout = await authorized('/logout', { method: 'POST', redirect: 'manual', headers: { Origin: origin } })
   assert.equal(logout.status, 303)
   assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
   let limited
   for (let n = 0; n < 11; n++) limited = await fetch(origin + '/login', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' })
   assert.equal(limited.status, 429)
   console.log('PASS: password HTTP/WS gates, signed/expired cookies, logout/login limits, frontend, health, origin/config/message limits, seat auth, two real Space Bunny turns, restart/chat/card/score persistence, interrupted-turn recovery, gateway restart session persistence, protected images')
} finally {
  for (const c of clients) c.socket.terminate()
  if (code) {
    assert.equal(spawnSync('systemctl', ['stop', 'cards-game']).status, 0)
    await rm(`/var/lib/cards-game/rooms/${code}.json`, { force: true })
    restart(); await healthy()
  }
}
