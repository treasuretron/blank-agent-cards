import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import { GameConfigSchema } from '@cards/shared'
import { createGameServer } from '../src/index.ts'

test('deployment profile rejects foreign origins, excessive connections, room/config caps and history growth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cards-limits-'))
  const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../../game.config.json', import.meta.url), 'utf8')))
  const app = await createGameServer({ config, directory, protection: {
    origins: ['https://cards.example'], maxRooms: 1, maxConnections: 2, maxThread: 1,
  } })
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening')
  const url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`
  const sockets: WebSocket[] = []
  async function connect() {
    const socket = new WebSocket(url, { origin: 'https://cards.example' }); sockets.push(socket)
    await once(socket, 'open')
    return socket
  }
  async function reject(origin: string) {
    const socket = new WebSocket(url, { origin }); sockets.push(socket)
    socket.on('error', () => {})
    const [, response] = await once(socket, 'unexpected-response')
    assert.equal(response.statusCode, 401); response.resume(); socket.terminate()
  }
  async function send(socket: WebSocket, message: object, type: string) {
    const result = new Promise<any>(resolve => {
      const receive = (data: WebSocket.RawData) => {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === type) { socket.off('message', receive); resolve(parsed) }
      }
      socket.on('message', receive)
    })
    socket.send(JSON.stringify(message))
    return result
  }
  try {
    await reject('https://foreign.example')
    const host = await connect(), other = await connect()
    await reject('https://cards.example')
    assert.match((await send(host, { type: 'createRoom', name: 'host', configOverrides: { cardsPerPlayer: 100 } }, 'error')).message, /limit/i)
    await send(host, { type: 'createRoom', name: 'host' }, 'joined')
    assert.match((await send(other, { type: 'createRoom', name: 'other' }, 'error')).message, /Room limit/)
    await send(host, { type: 'say', text: 'one entry' }, 'state')
    assert.match((await send(host, { type: 'say', text: 'too many' }, 'error')).message, /history limit/)
  } finally {
    for (const socket of sockets) socket.terminate()
    await new Promise<void>(resolve => app.ws.close(() => resolve()))
    await new Promise<void>(resolve => app.server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
