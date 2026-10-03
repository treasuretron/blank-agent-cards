import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// No inherited provider/proxy credentials, global config, plugins or project files.
const root = resolve(process.env.CARDS_OPENCODE_HOME ?? '/tmp/opencode/cards-runtime')
for (const name of ['home', 'config', 'data', 'cache', 'state', 'work']) await mkdir(resolve(root, name), { recursive: true, mode: 0o700 })
const env = {
  PATH: process.env.PATH,
  HOME: resolve(root, 'home'),
  XDG_CONFIG_HOME: resolve(root, 'config'),
  XDG_DATA_HOME: resolve(root, 'data'),
  XDG_CACHE_HOME: resolve(root, 'cache'),
  XDG_STATE_HOME: resolve(root, 'state'),
  OPENCODE_CONFIG: fileURLToPath(new URL('../opencode.json', import.meta.url)),
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  OPENCODE_PURE: '1',
  ...(process.env.CREDENTIALS_DIRECTORY ? { OPENCODE_SERVER_PASSWORD: (await readFile(resolve(process.env.CREDENTIALS_DIRECTORY, 'agent-password'), 'utf8')).trim(), OPENCODE_SERVER_USERNAME: 'cards-game' } : {}),
}
const args = process.argv.slice(2)
const port = Number(process.env.CARDS_OPENCODE_PORT ?? 4097)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CARDS_OPENCODE_PORT')
if (args.length && (args[0] !== 'auth' || args[1] !== 'login')) throw new Error('Only auth login or default private serve is supported')
const child = spawn('opencode', args.length ? args : ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: resolve(root, 'work'), env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
