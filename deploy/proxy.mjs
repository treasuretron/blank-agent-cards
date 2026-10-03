import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { readFile } from 'node:fs/promises'
import { createHmac, scrypt, timingSafeEqual, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

const auth = JSON.parse(await readFile(process.env.CARDS_GATEWAY_AUTH ?? `${process.env.CREDENTIALS_DIRECTORY}/gateway.json`, 'utf8'))
if (!/^[a-f0-9]{64}$/.test(auth.hash) || !/^[a-f0-9]{64}$/.test(auth.sessionKey) || !/^[a-f0-9]{32}$/.test(auth.salt)) throw new Error('Invalid gateway credentials')
const origins = new Set(['https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai', 'http://127.0.0.1:8080', 'http://localhost:8080'])
const cookieName = '__Host-cards_session'
const duration = 12 * 60 * 60
const sign = value => createHmac('sha256', auth.sessionKey).update(value).digest('base64url')
function authenticated(req) {
  const values = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName + '='))
  if (values.length !== 1) return 0
  const token = values[0].slice(cookieName.length + 1)
  if (!/^\d{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token)) return 0
  const [expires, nonce, signature] = token.split('.')
  const expected = sign(`${expires}.${nonce}`)
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && Number(expires) > Date.now() / 1000 && Number(expires) <= Date.now() / 1000 + duration ? Number(expires) : 0
}
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>1000 Black Agent Cards | Enter</title><style>body{background:#f4f1e8;color:#181818;font:18px Georgia,serif;display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:380px;padding:30px}h1{font-size:42px;line-height:1}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border:2px solid #181818;margin:8px 0}button{background:#181818;color:white;cursor:pointer}small{display:block;line-height:1.5}</style><main><h1>1000 Black<br>Agent Cards</h1><p>A private table for trusted friends.</p><form action="/login" method="post"><label for="password">Table password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128" autofocus><button>Enter the game</button></form><small>Space Bunny interprets your cards. Generated code remains experimental; the password is not a sandbox.</small></main></html>`
let attempts = 0, windowStart = Date.now(), hashing = false
function respond(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', ...headers }); res.end(body)
}

// Only these fixed upstreams are reachable. In particular there is no agent route.
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/login' && req.method === 'POST') {
    if (!origins.has(req.headers.origin)) { respond(res, 403, 'Origin rejected'); return }
    if (Date.now() - windowStart > 60000) { attempts = 0; windowStart = Date.now() }
    if (++attempts > 10 || hashing) { respond(res, 429, 'Please wait before trying again', { 'retry-after': '60' }); return }
    if (req.headers['content-type'] !== 'application/x-www-form-urlencoded' || Number(req.headers['content-length'] ?? 0) > 1024) { respond(res, 400, 'Invalid login'); return }
    hashing = true
    try {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 1024) { respond(res, 413, 'Login too large'); return } }
      const password = new URLSearchParams(body).get('password') ?? ''
      if (password.length > 128) { respond(res, 400, 'Invalid login'); return }
      const hash = await promisify(scrypt)(password, auth.salt, 32)
      if (!timingSafeEqual(hash, Buffer.from(auth.hash, 'hex'))) { respond(res, 401, page, { 'content-type': 'text/html; charset=utf-8' }); return }
      const value = `${Math.floor(Date.now() / 1000) + duration}.${randomBytes(16).toString('base64url')}`
      respond(res, 303, '', { location: '/', 'set-cookie': `${cookieName}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${duration}` })
    } catch { if (!res.headersSent) respond(res, 400, 'Invalid login') }
    finally { hashing = false }
    return
  }
  if (pathname === '/logout' && req.method === 'POST') {
    if (!origins.has(req.headers.origin)) { respond(res, 403, 'Origin rejected'); return }
    respond(res, 303, '', { location: '/login', 'set-cookie': `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }); return
  }
  if (!authenticated(req)) {
    if (req.method === 'GET' && (pathname === '/' || pathname === '/login')) respond(res, 200, page, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" })
    else respond(res, 401, 'Table password required')
    return
  }
  const port = pathname === '/health' || pathname.startsWith('/rooms/') ? 8787 : 3001
  const upstream = request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + port } }, response => {
    res.writeHead(response.statusCode, { ...response.headers, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
    response.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Upstream unavailable') })
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
})
server.on('upgrade', (req, socket, head) => {
  const expires = authenticated(req)
  if (req.url !== '/ws' || !expires || !origins.has(req.headers.origin)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
  const timer = setTimeout(() => socket.destroy(), expires * 1000 - Date.now())
  timer.unref(); socket.on('close', () => clearTimeout(timer))
  const upstream = connect(8787, '127.0.0.1', () => {
    upstream.write(`${req.method} /ws HTTP/1.1\r\n${Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy())
})
server.requestTimeout = 10000
server.headersTimeout = 10000
server.listen(8080, '127.0.0.1')
