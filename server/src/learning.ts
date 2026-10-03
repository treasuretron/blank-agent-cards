import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LearningNote } from '@cards/shared'

// Learning-mode files for every room: <CODE>.jsonl (one note per play) and
// <CODE>-report.md (written once the game ends).
export class LearningStore {
  constructor(readonly directory: string) {}

  async append(code: string, note: LearningNote) {
    await mkdir(this.directory, { recursive: true })
    await appendFile(path.join(this.directory, `${code}.jsonl`), JSON.stringify(note) + '\n', { mode: 0o600 })
  }

  async notes(code: string): Promise<LearningNote[]> {
    const text = await readFile(path.join(this.directory, `${code}.jsonl`), 'utf8').catch(() => '')
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as LearningNote)
  }

  async writeReport(code: string, markdown: string) {
    await mkdir(this.directory, { recursive: true })
    const file = path.join(this.directory, `${code}-report.md`)
    await writeFile(`${file}.tmp`, markdown, { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }

  async report(code: string): Promise<string | null> {
    return readFile(path.join(this.directory, `${code}-report.md`), 'utf8').catch(() => null)
  }
}

// The numbers half of the report, computed by the server so it holds even when
// the agent's advice is missing or wrong.
export function learningStats(notes: LearningNote[]): string {
  if (!notes.length) return 'No plays were recorded.'
  const durations = notes.map(n => n.metrics.durationMs).sort((a, b) => a - b)
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
  const lines = [
    '| | |', '|---|---|',
    `| plays | ${notes.length} |`,
    `| failed interpretations | ${notes.filter(n => n.metrics.failed).length} |`,
    `| retries after a rejected patch | ${notes.reduce((n, note) => n + note.metrics.attempts - 1, 0)} |`,
    `| engine rewrites | ${notes.filter(n => n.metrics.engineChanged).length} |`,
    `| interpretation time, median | ${seconds(durations[Math.floor((durations.length - 1) / 2)])} |`,
    `| interpretation time, slowest | ${seconds(durations.at(-1)!)} |`,
    `| interpretation time, total | ${seconds(durations.reduce((a, b) => a + b, 0))} |`,
  ]
  const slowest = [...notes].sort((a, b) => b.metrics.durationMs - a.metrics.durationMs).slice(0, 3)
  lines.push('', '**Slowest plays**', '', ...slowest.map(n => `- turn ${n.turn}, ${label(n)}: ${seconds(n.metrics.durationMs)}${n.metrics.engineChanged ? ', rewrote the engine' : ''}${n.metrics.attempts > 1 ? `, ${n.metrics.attempts} attempts` : ''}`))
  for (const [title, values] of [
    ['Mechanics (agent-tagged)', notes.flatMap(n => n.reflection?.mechanics ?? [])],
    ['Effect kinds used', notes.flatMap(n => n.effects)],
    ['Rules changed', notes.flatMap(n => n.rulesChanged)],
  ] as const) {
    if (!values.length) continue
    const counts = new Map<string, number>()
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
    lines.push('', `**${title}**`, '', [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${k}\` ×${v}`).join(', '))
  }
  return lines.join('\n')
}

export function renderReport(code: string, notes: LearningNote[], stats: string, advice: string | null, adviceError?: string): string {
  const turns = notes.map(n => {
    const r = n.reflection
    const head = `### Turn ${n.turn}: ${label(n)} (${n.playerName})`
    if (n.metrics.failed) return `${head}\n\nInterpretation failed: ${n.metrics.engineError ?? 'unknown error'}`
    if (!r) return `${head}\n\nNo reflection${n.reflectionError ? `: ${n.reflectionError}` : '.'}`
    return [head, '', `- mechanics: ${r.mechanics.map(m => `\`${m}\``).join(', ') || 'none'}`, `- integration: ${r.integration}`, `- friction: ${r.friction}`, `- suggestion: ${r.suggestion}`].join('\n')
  })
  return [
    `# Learning report: game ${code}`, '', `_Generated ${new Date().toISOString()}._`, '',
    '## Numbers', '', stats, '',
    '## Advice for fast mode', '', advice ?? (adviceError ? `The agent could not write advice: ${adviceError}` : 'This agent has no report step; see the numbers and turn notes.'), '',
    '## Turn notes', '', ...turns.flatMap(t => [t, '']),
  ].join('\n')
}

const label = (n: LearningNote) => `"${n.card.title || n.card.text.slice(0, 40)}"`
