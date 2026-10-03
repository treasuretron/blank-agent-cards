import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import WebSocket from 'ws'

// No passwords, cookies, seat tokens, prompts or card contents are printed.
const url = 'https://blank-agent-cards-c8a3daed.style.dev'
const password = (await readFile('/etc/cards/initial-password', 'utf8')).trim()
const login = await fetch(url + '/login', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Origin: url, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) })
assert.equal(login.status, 303)
const cookie = login.headers.get('set-cookie').split(';')[0]
const sockets = []
async function client() {
  const socket = new WebSocket(url.replace('https:', 'wss:') + '/ws', { origin: url, headers: { Cookie: cookie }, handshakeTimeout: 10000 })
  sockets.push(socket)
  const messages = []
  socket.on('message', data => messages.push(JSON.parse(data.toString())))
  await once(socket, 'open')
  return { send: message => socket.send(JSON.stringify(message)), async wait(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (messages.some(m => m.type === 'error')) throw new Error('Service returned a verification error')
      const index = messages.findIndex(predicate)
      if (index >= 0) return messages.splice(index, 1)[0]
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Verification deadline exceeded')
  } }
}
try {
  const host = await client()
  host.send({ type: 'createRoom', name: 'Integration verification' })
  const joined = await host.wait(m => m.type === 'joined')
  console.log(JSON.stringify({ verificationRoom: joined.code }))
  const started = Date.now()
  host.send({ type: 'generateCards', count: 4 })
  await host.wait(m => m.type === 'state' && m.snapshot.generating?.count === 4)
  const result = await host.wait(m => m.type === 'state' && !m.snapshot.generating && m.snapshot.myCards.length > 0, 100000)
  assert.equal(result.snapshot.myCards.length, 4)
  assert.ok(result.snapshot.myCards.every(c => c.byAgent))
  const saved = JSON.parse(await readFile(`/var/lib/cards-game/rooms/${joined.code}.json`, 'utf8'))
  assert.equal(saved.generated, 4)
  assert.equal(saved.cards.length, 4)
  for (const card of result.snapshot.myCards) {
    const image = await fetch(url + card.imageUrl, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) })
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.ok((await image.arrayBuffer()).byteLength > 100)
    assert.equal((await fetch(url + card.imageUrl)).status, 401)
    assert.equal((await fetch(url + card.imageUrl.split('?')[0], { headers: { Cookie: cookie } })).status, 404)
  }
  const generationMs = Date.now() - started
  const guest = await client()
  guest.send({ type: 'joinRoom', code: joined.code, name: 'Integration guest' })
  await guest.wait(m => m.type === 'joined')
  const { createCanvas } = await import('../server/node_modules/@napi-rs/canvas/index.js')
  const canvas = createCanvas(480, 480), context = canvas.getContext('2d')
  context.fillStyle = 'white'; context.fillRect(0, 0, 480, 480)
  for (let count = 1; count <= 4; count++) {
    guest.send({ type: 'submitCard', card: { text: 'Gain 10 points.', art: canvas.toDataURL('image/png') } })
    await guest.wait(m => m.type === 'state' && m.snapshot.myCards.length === count)
  }
  host.send({ type: 'startGame' })
  await host.wait(m => m.type === 'state' && m.snapshot.phase === 'play' && m.snapshot.players.length === 2)
  await guest.wait(m => m.type === 'state' && m.snapshot.phase === 'play' && m.snapshot.hand.length === 3)
  guest.send({ type: 'endGame' })
  const ended = await host.wait(m => m.type === 'state' && m.snapshot.phase === 'ended' && m.snapshot.endedBy)
  assert.equal(ended.snapshot.gameCards.length, 8)
  const resumed = await client()
  resumed.send({ type: 'resume', code: joined.code, token: joined.token })
  const restored = await resumed.wait(m => m.type === 'state' && m.snapshot.phase === 'ended')
  assert.equal(restored.snapshot.gameCards.length, 8)
  console.log(JSON.stringify({ ok: true, publicWss: true, pendingObserved: true, count: 4, persisted: true, protectedPngs: 4, twoPlayers: true, endGame: true, resume: true, generationMs }))
} finally {
  for (const socket of sockets) socket.terminate()
}
