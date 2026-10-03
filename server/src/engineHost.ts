import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { RulesSchema, AgentVerdictSchema, type GameState, type Play, type GameAgent, type AgentInput } from '@cards/shared'

const StateSchema = z.object({
  players: z.array(z.object({ id: z.string(), name: z.string(), score: z.number().finite(), hand: z.array(z.string()) })),
  deck: z.array(z.string()), discard: z.array(z.string()),
  turn: z.object({ playerId: z.string(), number: z.number().int().positive(), playsThisTurn: z.number().int().nonnegative() }),
  rules: RulesSchema, vars: z.record(z.string(), z.unknown()), winnerId: z.string().nullable(),
})
const ResultSchema = z.object({
  version: z.number().int().positive(), valid: z.object({ ok: z.boolean(), reason: z.string().optional() }),
  result: z.object({ state: StateSchema, events: z.array(z.object({ text: z.string() })) }).nullable(),
  win: z.object({ winnerId: z.string().nullable() }),
})

export function runEngine(source: string, state: GameState, play: Play, timeout: number, apply = true) {
  return new Promise<z.infer<typeof ResultSchema>>((resolve, reject) => {
    const worker = fileURLToPath(new URL('./engine-worker.mjs', import.meta.url))
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${worker}`, '--experimental-vm-modules', '--max-old-space-size=64', worker], {
      env: {}, stdio: ['pipe', 'pipe', 'pipe'], cwd: '/tmp',
    })
    let stdout = '', stderr = '', settled = false
    const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); child.kill('SIGKILL'); reject(error) } }
    const timer = setTimeout(() => fail(new Error('Engine timeout')), timeout)
    child.on('error', fail)
    child.stdin.on('error', fail)
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2_000_000) fail(new Error('Engine output too large')) })
    child.stderr.on('data', chunk => { if (stderr.length < 16_000) stderr += chunk })
    child.on('close', code => {
      if (settled) return
      try {
        if (code !== 0) throw new Error(stderr || `Engine exited ${code}`)
        const result = ResultSchema.parse(JSON.parse(stdout))
        if (result.result) validateMechanicalState(state, result.result.state, play)
        if (result.win.winnerId !== null && !state.players.some(p => p.id === result.win.winnerId)) throw new Error('Invalid winner')
        settled = true; clearTimeout(timer); resolve(result)
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
    child.stdin.end(JSON.stringify({ source, state, play, timeout, apply }))
  })
}

function validateMechanicalState(before: GameState, after: GameState, play: Play) {
  if (JSON.stringify(before.players.map(p => [p.id, p.name])) !== JSON.stringify(after.players.map(p => [p.id, p.name]))) throw new Error('Engine changed player identities')
  const cards = (state: GameState) => [...state.deck, ...state.discard, ...state.players.flatMap(p => p.hand)].sort()
  if (JSON.stringify(cards(before)) !== JSON.stringify(cards(after))) throw new Error('Engine lost, duplicated, or invented cards')
  if (!after.players.some(p => p.id === after.turn.playerId)) throw new Error('Invalid turn player')
  if (after.players.some(p => p.hand.includes(play.card.id)) || !after.discard.includes(play.card.id)) throw new Error('Played card must be discarded')
}

export async function interpretPlay(agent: GameAgent, input: AgentInput, retries: number, timeout: number) {
  let previousError: string | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()
      const raw = await Promise.race([
        (agent as GameAgent & { interpret(input: AgentInput, signal?: AbortSignal): ReturnType<GameAgent['interpret']> }).interpret(structuredClone({ ...input, previousError }), controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(new Error('Agent timeout')); reject(new Error('Agent timeout')) }, timeout) }),
      ]).finally(() => clearTimeout(timer))
      const verdict = AgentVerdictSchema.parse(raw)
      const rules = RulesSchema.parse({ ...input.rules, ...verdict.rulesPatch })
      const source = verdict.enginePatch ?? input.engineSource
      const result = await runEngine(source, { ...structuredClone(input.state), rules }, { playerId: input.playerId, card: input.card, effects: verdict.effects }, timeout)
      if (!result.valid.ok || !result.result) throw new Error(result.valid.reason ?? 'Candidate rejected play')
      result.result.state.winnerId = result.win.winnerId
      return { verdict, source, result, error: undefined }
    } catch (error) { previousError = String(error) }
  }
  return { error: previousError ?? 'Interpretation failed' }
}
