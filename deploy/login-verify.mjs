import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import WebSocket from 'ws'

// This check reads the table password privately and does not restart the game.
const url = process.env.CARDS_VERIFY_URL ?? 'http://127.0.0.1:8080'
const origin = process.env.CARDS_VERIFY_ORIGIN ?? 'https://blank-agent-cards-c8a3daed.style.dev'
const headers = { Origin: origin }
const page = await fetch(url, { headers })
assert.equal(page.status, 200)
assert.equal(page.headers.get('referrer-policy'), 'same-origin')
assert.ok((await page.text()).includes('Table password'))
assert.equal((await fetch(url + '/health')).status, 401)
const password = (await readFile('/etc/cards/initial-password', 'utf8')).trim()
const login = await fetch(url + '/login', { method: 'POST', redirect: 'manual', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) })
assert.equal(login.status, 303)
assert.equal(login.headers.get('location'), '/')
assert.ok(/; Path=\/; HttpOnly; Secure; SameSite=Strict;/.test(login.headers.get('set-cookie')))
const cookie = login.headers.get('set-cookie').split(';')[0]
const authorized = path => fetch(url + path, { headers: { ...headers, Cookie: cookie } })
const frontend = await authorized(login.headers.get('location'))
assert.equal(frontend.status, 200)
const html = await frontend.text()
assert.ok(!html.includes('Table password'))
const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1].replaceAll('&amp;', '&')))]
assert.ok(assets.length > 0)
for (const asset of assets) {
  assert.equal((await authorized(asset)).status, 200)
  assert.equal((await fetch(url + asset)).status, 401)
}
assert.equal((await authorized('/health')).status, 200)
for (const path of ['/global/health', '/etc/cards/gateway.json', '/.git/config']) {
  assert.equal((await authorized(path)).status, 404)
}
const socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws', { origin, headers: { ...headers, Cookie: cookie }, handshakeTimeout: 10000 })
try {
  await once(socket, 'open')
} finally {
  socket.terminate()
}
for (const options of [{ origin }, { origin: 'https://evil.example', headers: { Cookie: cookie } }, { headers: { Cookie: cookie } }]) {
  const denied = new WebSocket(url.replace(/^http/, 'ws') + '/ws', { ...options, handshakeTimeout: 10000 })
  denied.on('error', () => {})
  const [, response] = await once(denied, 'unexpected-response')
  assert.equal(response.statusCode, 401)
  response.resume(); denied.terminate()
}
for (const denied of ['null', 'https://evil.example']) {
  for (const path of ['/login', '/logout']) {
    assert.equal((await fetch(url + path, { method: 'POST', headers: { ...headers, Origin: denied, Cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' })).status, 403)
  }
}
const logout = await fetch(url + '/logout', { method: 'POST', redirect: 'manual', headers: { ...headers, Cookie: cookie } })
assert.equal(logout.status, 303)
assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'))
console.log(`PASS: ${url}, password form, login cookie/redirect, frontend, ${assets.length} protected assets, health, upstream WebSocket, foreign/null Origin rejection and logout`)
