import { cp, mkdir, rm, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = '/var/lib/cards-web/app'
await mkdir(target, { recursive: true })
for (const name of ['web', 'shared']) {
  await rm(target + '/' + name, { recursive: true, force: true })
  await cp(root + name, target + '/' + name, {
    recursive: true, filter: path => !path.split('/').some(part => ['node_modules', '.next', 'tsconfig.tsbuildinfo'].includes(part)),
  })
}
await cp(root + 'package.json', target + '/package.json')
try { await symlink('/opt/cards/node_modules', target + '/node_modules') } catch (error) { if (error.code !== 'EEXIST') throw error }
const result = spawnSync('/usr/local/bin/node', ['/opt/cards/node_modules/next/dist/bin/next', 'build', '--webpack'], {
  cwd: target + '/web', stdio: 'inherit', env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/var/lib/cards-web', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SERVER_URL: 'same-origin' },
})
if (result.status !== 0) process.exit(result.status ?? 1)
