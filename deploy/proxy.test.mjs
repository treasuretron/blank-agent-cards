import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'

test('canonical proxy form origins, retry policy and CSRF protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cards-gateway-'))
  const password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex')
  const oldAuth = process.env.CARDS_GATEWAY_AUTH, oldPort = process.env.CARDS_GATEWAY_PORT
  let server
  try {
    process.env.CARDS_GATEWAY_AUTH = join(directory, 'gateway.json')
    process.env.CARDS_GATEWAY_PORT = '0'
    await writeFile(process.env.CARDS_GATEWAY_AUTH, JSON.stringify({ salt, hash: scryptSync(password, salt, 32).toString('hex'), sessionKey: randomBytes(32).toString('hex') }), { mode: 0o600 })
    ;({ server } = await import('./proxy.mjs'))
    if (!server.listening) await once(server, 'listening')
    const url = `http://127.0.0.1:${server.address().port}`
    const origin = 'https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai'
    const forwarded = { 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https' }
    const post = (path, requestOrigin, headers = {}, value = password) => fetch(url + path, {
      method: 'POST', redirect: 'manual', headers: {
        ...forwarded, 'content-type': 'application/x-www-form-urlencoded',
        ...(requestOrigin === undefined ? {} : { Origin: requestOrigin }), ...headers,
      }, body: new URLSearchParams({ password: value }),
    })
    for (const path of ['/', '/login']) {
      const page = await fetch(url + path, { headers: forwarded })
      assert.equal(page.status, 200)
      assert.equal(page.headers.get('referrer-policy'), 'same-origin')
      assert.match(page.headers.get('content-security-policy'), /form-action 'self'/)
    }
    const retry = await post('/login', origin, {}, 'wrong')
    assert.equal(retry.status, 401)
    assert.equal(retry.headers.get('referrer-policy'), 'same-origin')
    assert.match(await retry.text(), /form action="\/login"/)
    const login = await post('/login', origin)
    assert.equal(login.status, 303)
    assert.equal(login.headers.get('location'), '/')
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie, /^__Host-cards_session=.*; Path=\/; HttpOnly; Secure; SameSite=Strict;/)
    assert.equal((await post('/login', 'https://blank-agent-cards-c8a3daed.style.dev')).status, 303)
    for (const denied of [undefined, 'null', 'https://evil.example', origin + '.evil.example']) {
      for (const path of ['/login', '/logout']) {
        assert.equal((await post(path, denied, { Cookie: cookie.split(';')[0] })).status, 403)
      }
    }
    assert.equal((await post('/login', 'https://evil.example', { Host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })).status, 403)
    assert.equal((await post('/logout', origin, { Cookie: cookie.split(';')[0] })).status, 303)
    for (const denied of [undefined, 'null', 'https://evil.example']) {
      const socket = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: denied, headers: { ...forwarded, Cookie: cookie.split(';')[0] } })
      socket.on('error', () => {})
      const [, response] = await once(socket, 'unexpected-response')
      assert.equal(response.statusCode, 401)
      response.resume(); socket.terminate()
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    if (oldAuth === undefined) delete process.env.CARDS_GATEWAY_AUTH
    else process.env.CARDS_GATEWAY_AUTH = oldAuth
    if (oldPort === undefined) delete process.env.CARDS_GATEWAY_PORT
    else process.env.CARDS_GATEWAY_PORT = oldPort
    await rm(directory, { recursive: true, force: true })
  }
})
