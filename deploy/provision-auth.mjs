import { randomBytes, scryptSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

if (process.getuid() !== 0) throw new Error('Run with sudo')
await mkdir('/etc/cards', { recursive: true, mode: 0o700 })
const password = randomBytes(9).toString('base64url')
const salt = randomBytes(16).toString('hex')
// Exclusive creation prevents accidental rotation on repeated installation.
await writeFile('/etc/cards/gateway.json', JSON.stringify({ salt, hash: scryptSync(password, salt, 32).toString('hex'), sessionKey: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' })
await writeFile('/etc/cards/initial-password', password + '\n', { mode: 0o600, flag: 'wx' })
await writeFile('/etc/cards/agent-password', randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' })
console.log('Private credentials created under /etc/cards; no secrets printed. Deliver initial-password privately.')
