import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { ClientMsgSchema, GameConfigSchema, type GameConfig } from '@cards/shared'
import { Rooms, type Peer } from './rooms.ts'

export async function createGameServer(options: { config: GameConfig; directory: string; rooms?: Rooms; protection?: { origins: string[]; maxRooms: number; maxConnections: number; maxThread: number } }) {
  const rooms = options.rooms ?? new Rooms(options.config, options.directory)
  await rooms.load()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    // Card images are gated by the seat token in the URL, not by origin; this lets
    // the end-of-game download read them when the web app runs on another port.
    response.setHeader('Access-Control-Allow-Origin', '*')
    if (request.method === 'GET' && url.pathname === '/health') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true })); return
    }
    const match = url.pathname.match(/^\/rooms\/([A-Z]{4})\/cards\/([a-f0-9-]+)$/)
    if (request.method === 'GET' && match) {
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      const image = rooms.image(match[1], match[2], bearer ?? url.searchParams.get('token') ?? '')
      if (image) { response.setHeader('Content-Type', 'image/png'); response.end(image); return }
      response.writeHead(404); response.end('Not found'); return
    }
    const report = url.pathname.match(/^\/rooms\/([A-Z]{4})\/learning-report$/)
    if (request.method === 'GET' && report) {
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      rooms.learningReport(report[1], bearer ?? url.searchParams.get('token') ?? '').then(markdown => {
        if (markdown !== null) { response.setHeader('Content-Type', 'text/markdown; charset=utf-8'); response.end(markdown); return }
        response.writeHead(404); response.end('Not found')
      }, () => { response.writeHead(500); response.end('Error') })
      return
    }
    const saved = url.pathname.match(/^\/rooms\/([A-Z]{4})\/library\/([a-z0-9-]+--[a-f0-9-]{36})$/)
    if (request.method === 'GET' && saved) {
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      rooms.libraryImage(saved[1], saved[2], bearer ?? url.searchParams.get('token') ?? '').then(image => {
        if (image) { response.setHeader('Content-Type', 'image/png'); response.end(image); return }
        response.writeHead(404); response.end('Not found')
      }, () => { response.writeHead(500); response.end('Error') })
      return
    }
    response.writeHead(404); response.end('Not found')
  })
  const protection = options.protection
  const ws = new WebSocketServer({ server, path: '/ws', maxPayload: 3_100_000,
    verifyClient: (info: { origin: string }) => !protection || (ws.clients.size < protection.maxConnections && protection.origins.includes(info.origin)),
  })
  ws.on('connection', socket => {
    const peer: Peer = { send: message => { if (socket.bufferedAmount > 8_000_000) socket.terminate(); else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)) } }
    let queue = Promise.resolve()
    let pending = 0, allowance = 20, last = Date.now(), alive = true
    socket.on('pong', () => { alive = true })
    const heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping() } }, 30_000)
    socket.on('close', () => clearInterval(heartbeat))
    socket.on('message', (data, binary) => {
      if (protection) {
        const now = Date.now()
        allowance = Math.min(20, allowance + (now - last) / 1000); last = now
        if (allowance < 1 || pending >= 4) { socket.close(1008, 'Message limit'); return }
        allowance--; pending++
      }
      queue = queue.then(async () => {
        try {
          if (binary) throw new Error('Expected JSON text')
          const message = ClientMsgSchema.parse(JSON.parse(data.toString()))
          if (protection) {
            if (message.type === 'createRoom') {
              if (rooms.rooms.size >= protection.maxRooms) throw new Error('Room limit reached')
              const config = { ...options.config, ...message.configOverrides }
              if (config.maxPlayers > 6 || config.cardsPerPlayer > 8 || config.handSize > 8 || config.targetScore > 1000) throw new Error('Deployment configuration limit')
            }
            if (peer.room && peer.room.thread.length >= protection.maxThread && !['resume', 'joinRoom'].includes(message.type)) throw new Error('Room history limit reached; create a new room')
          }
          await rooms.handle(peer, message)
        } catch (error) { peer.send({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
        finally { if (protection) pending-- }
      })
    })
    socket.on('close', () => rooms.disconnect(peer))
    socket.on('error', () => rooms.disconnect(peer))
  })
  return { server, ws, rooms }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
  const app = await createGameServer({ config, directory: process.env.ROOM_DATA_DIR ?? fileURLToPath(new URL('../../game/rooms', import.meta.url)) })
  app.server.listen(Number(process.env.PORT ?? config.server.port), process.env.HOST ?? '0.0.0.0', () => console.log(`Game server listening on ${(app.server.address() as { port: number }).port}`))
}
