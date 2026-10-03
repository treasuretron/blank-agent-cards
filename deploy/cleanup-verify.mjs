import assert from 'node:assert/strict'
import { readFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

// Remove only a room created by generate-service-verify, never a player's room.
assert.equal(process.getuid(), 0, 'Run with sudo')
const code = process.argv[2]
assert.match(code ?? '', /^[A-Z]{4}$/)
const directory = '/var/lib/cards-game/rooms'
const filename = `${code}.json`
const room = JSON.parse(await readFile(`${directory}/${filename}`, 'utf8'))
assert.equal(room.seats[0]?.name, 'Integration verification')
const password = (await readFile('/etc/cards/agent-password', 'utf8')).trim()
const headers = { Authorization: 'Basic ' + Buffer.from('cards-game:' + password).toString('base64') }
function service(action, ...units) {
  assert.equal(spawnSync('systemctl', [action, ...units], { stdio: 'inherit' }).status, 0)
}
async function idle() {
  const response = await fetch('http://127.0.0.1:4097/session/status', { headers, signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  const statuses = Object.values(await response.json())
  const rooms = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(`${directory}/${name}`, 'utf8'))))
  return statuses.every(status => status.type === 'idle') && rooms.every(room => !room.pendingCard)
}
service('stop', 'cards-preview')
try {
  let drained = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await idle()) { drained = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(drained, 'Inference did not drain; no rooms removed')
  service('stop', 'cards-game')
  try {
    const names = (await readdir(directory)).filter(name => name.endsWith('.json') && name !== filename)
    const hashes = await Promise.all(names.map(async name => createHash('sha256').update(await readFile(`${directory}/${name}`)).digest('hex')))
    await rm(`${directory}/${filename}`)
    for (let index = 0; index < names.length; index++) assert.equal(createHash('sha256').update(await readFile(`${directory}/${names[index]}`)).digest('hex'), hashes[index])
    console.log(JSON.stringify({ removedOwnVerificationRoom: code, preservedRooms: names.length, byteIdentical: true, inferenceDrained: true }))
  } finally {
    service('start', 'cards-game')
  }
} finally {
  service('start', 'cards-preview')
}
