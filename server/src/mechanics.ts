import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The reviewed snippet library in game/mechanics/. Engines import it as
// `import { stealPoints } from 'mechanics'`; the engine worker serves these
// sources, so engine code still never touches the filesystem.
//
// Rooms persist engines that import these names, so treat the library as
// append-only: add functions freely, but never rename, remove, or change the
// meaning of an existing one.

export type Mechanics = { sources: Record<string, string>; catalog: string; names: string[] }

export function loadMechanics(directory = fileURLToPath(new URL('../../game/mechanics/', import.meta.url))): Mechanics {
  const sources: Record<string, string> = {}
  const docs: string[] = []
  const owners = new Map<string, string>()
  for (const file of readdirSync(directory).filter(f => /^[a-z0-9-]+\.mjs$/.test(f)).sort()) {
    const name = file.slice(0, -'.mjs'.length)
    const source = readFileSync(`${directory}/${file}`, 'utf8')
    if (/^\s*import\b/m.test(source)) throw new Error(`mechanics/${file} must not import anything`)
    sources[name] = source
    for (const [, fn] of source.matchAll(/^export function (\w+)/gm)) {
      // `export *` silently drops names exported by two files, so refuse instead.
      if (owners.has(fn)) throw new Error(`Mechanic ${fn} is exported by both ${owners.get(fn)} and ${file}`)
      owners.set(fn, file)
      const doc = source.match(new RegExp(`^// (${fn}\\(.*)$\\n^export function ${fn}\\b`, 'm'))
      if (!doc) throw new Error(`Mechanic ${fn} in ${file} needs a "// ${fn}(...) → ..." comment on the line above it`)
      docs.push(doc[1])
    }
  }
  return { sources, catalog: docs.join('\n'), names: [...owners.keys()] }
}

export const mechanics = loadMechanics()
