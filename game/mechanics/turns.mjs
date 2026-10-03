// Reviewed mechanics: turn order. These read `state.rules.direction` and
// `state.vars`; the engine still decides when to call `advanceTurn`.

// playerAfter(state, playerId, steps = 1) → player: the player `steps` seats away in the current direction.
export function playerAfter(state, playerId, steps = 1) {
  const index = state.players.findIndex(p => p.id === playerId)
  if (index < 0) throw new Error(`Unknown player: ${playerId}`)
  const n = state.players.length
  return state.players[(((index + state.rules.direction * steps) % n) + n) % n]
}

// reverseDirection(state) → events: flip turn order.
export function reverseDirection(state) {
  state.rules.direction *= -1
  return [{ text: 'Turn order reverses' }]
}

// skipNextTurns(state, playerId, turns = 1) → events: the player misses their next `turns` turns (see advanceTurn).
export function skipNextTurns(state, playerId, turns = 1) {
  if (!Number.isInteger(turns) || turns < 0) throw new Error('skipNextTurns: turns must be a non-negative integer')
  const skips = (state.vars.skipTurns ??= {})
  skips[playerId] = (skips[playerId] ?? 0) + turns
  const name = state.players.find(p => p.id === playerId)?.name ?? playerId
  return [{ text: `${name} will miss ${turns} turn${turns === 1 ? '' : 's'}` }]
}

// extraTurn(state, playerId) → events: the player goes again after this turn (see advanceTurn).
export function extraTurn(state, playerId) {
  state.vars.extraTurn = playerId
  const name = state.players.find(p => p.id === playerId)?.name ?? playerId
  return [{ text: `${name} takes another turn` }]
}

// advanceTurn(state, fromId, skip = 0) → events: move the turn on, honouring extraTurn, skipNextTurns, and empty hands.
export function advanceTurn(state, fromId, skip = 0) {
  const events = []
  let nextId = null
  if (state.vars.extraTurn) {
    const extra = state.players.find(p => p.id === state.vars.extraTurn && p.hand.length)
    delete state.vars.extraTurn
    if (extra) nextId = extra.id
  }
  const skips = state.vars.skipTurns ?? {}
  for (let step = 1 + skip; nextId === null && step <= state.players.length * 4 + skip; step++) {
    const candidate = playerAfter(state, fromId, step)
    if (!candidate.hand.length) continue
    if (skips[candidate.id] > 0) {
      skips[candidate.id]--
      events.push({ text: `${candidate.name} misses a turn` })
      continue
    }
    nextId = candidate.id
  }
  if (nextId !== null) state.turn = { playerId: nextId, number: state.turn.number + 1, playsThisTurn: 0 }
  return events
}
