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
const socket = new WebSocket(url.replace('https:', 'wss:') + '/ws', { origin: url, headers: { Cookie: cookie }, handshakeTimeout: 10000 })
const messages = []
socket.on('message', data => messages.push(JSON.parse(data.toString())))
async function wait(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const error = messages.find(m => m.type === 'error')
    if (error) throw new Error('Service returned a generation error')
    const found = messages.find(predicate)
    if (found) return found
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Verification deadline exceeded')
}
try {
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'createRoom', name: 'Generation verification' }))
  const joined = await wait(m => m.type === 'joined', 10000)
  console.log(JSON.stringify({ verificationRoom: joined.code }))
  const started = Date.now()
  socket.send(JSON.stringify({ type: 'generateCards', count: 4 }))
  await wait(m => m.type === 'state' && m.snapshot.generating?.count === 4, 10000)
  const result = await wait(m => m.type === 'state' && !m.snapshot.generating && m.snapshot.myCards.length > 0, 100000)
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
  }
  console.log(JSON.stringify({ ok: true, publicWss: true, pendingObserved: true, count: 4, persisted: true, protectedPngs: 4, elapsedMs: Date.now() - started }))
} finally {
  socket.terminate()
}
