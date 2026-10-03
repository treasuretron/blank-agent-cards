// Reviewed mechanics: lookups and lasting effects kept in `state.vars`.

// leader(state) → player | null: the player with the highest score; null on a tie.
export function leader(state) {
  const top = Math.max(...state.players.map(p => p.score))
  const leaders = state.players.filter(p => p.score === top)
  return leaders.length === 1 ? leaders[0] : null
}

// lastPlace(state) → player | null: the player with the lowest score; null on a tie.
export function lastPlace(state) {
  const bottom = Math.min(...state.players.map(p => p.score))
  const last = state.players.filter(p => p.score === bottom)
  return last.length === 1 ? last[0] : null
}

// randomOpponent(state, playerId) → player | null: a random other player.
export function randomOpponent(state, playerId) {
  const others = state.players.filter(p => p.id !== playerId)
  return others.length ? others[Math.floor(Math.random() * others.length)] : null
}

// addCounter(state, key, delta = 1) → number: bump a named counter in state.vars.counters and return it.
export function addCounter(state, key, delta = 1) {
  const counters = (state.vars.counters ??= {})
  counters[key] = (counters[key] ?? 0) + delta
  return counters[key]
}

// addTimedEffect(state, effect, turns) → events: store `effect` (plain JSON) in state.vars.timed for `turns` turns.
export function addTimedEffect(state, effect, turns) {
  if (!Number.isInteger(turns) || turns < 1) throw new Error('addTimedEffect: turns must be a positive integer')
  ;(state.vars.timed ??= []).push({ ...effect, turnsLeft: turns })
  return [{ text: `${effect.kind ?? 'Effect'} lasts ${turns} turn${turns === 1 ? '' : 's'}` }]
}

// activeTimedEffects(state, kind?) → effects[]: timed effects still running, optionally of one kind.
export function activeTimedEffects(state, kind) {
  return (state.vars.timed ?? []).filter(e => kind === undefined || e.kind === kind)
}

// tickTimedEffects(state) → events: count every timed effect down by one turn and drop expired ones.
export function tickTimedEffects(state) {
  const timed = state.vars.timed ?? []
  for (const effect of timed) effect.turnsLeft--
  const expired = timed.filter(e => e.turnsLeft <= 0)
  state.vars.timed = timed.filter(e => e.turnsLeft > 0)
  return expired.map(e => ({ text: `${e.kind ?? 'Effect'} wears off` }))
}
