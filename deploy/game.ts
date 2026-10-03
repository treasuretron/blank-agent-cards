import { readFile } from 'node:fs/promises'
import { GameConfigSchema } from '@cards/shared'
import { createGameServer } from '../server/src/index.ts'

const config = GameConfigSchema.parse(JSON.parse(await readFile(new URL('../game.config.json', import.meta.url), 'utf8')))
config.agent.provider = 'opencode'
config.agent.model = 'opencode/space-bunny-free'
process.env.CARDS_AGENT_PASSWORD = (await readFile(`${process.env.CREDENTIALS_DIRECTORY}/agent-password`, 'utf8')).trim()
const app = await createGameServer({ config, directory: '/var/lib/cards-game/rooms', protection: {
  origins: ['https://blank-agent-cards-c8a3daed.style.dev', 'https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai', 'http://127.0.0.1:8080', 'http://localhost:8080'],
  maxRooms: 20, maxConnections: 48, maxThread: 300,
} })
for (const room of app.rooms.rooms.values()) {
  if (room.config.maxPlayers > 6 || room.config.cardsPerPlayer > 8) throw new Error('Deployment refuses oversized persisted rooms')
}
app.server.listen(8787, '127.0.0.1', () => console.log('Trusted-friends Space Bunny game listening on localhost:8787'))
