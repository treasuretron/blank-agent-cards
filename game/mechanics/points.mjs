// Reviewed mechanics: scoring. Every function mutates `state` and returns engine events.

const player = (state, id) => {
  const found = state.players.find(p => p.id === id)
  if (!found) throw new Error(`Unknown player: ${id}`)
  return found
}
const signed = amount => `${amount >= 0 ? '+' : ''}${amount}`

// addPoints(state, playerId, amount) → events: add (or with a negative amount, remove) points.
export function addPoints(state, playerId, amount) {
  if (!Number.isFinite(amount)) throw new Error('addPoints: amount must be a number')
  const target = player(state, playerId)
  target.score += amount
  return [{ text: `${target.name}: ${signed(amount)} points` }]
}

// stealPoints(state, fromId, toId, amount) → events: move up to `amount` points, never taking the victim below 0.
export function stealPoints(state, fromId, toId, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('stealPoints: amount must be a non-negative number')
  const from = player(state, fromId), to = player(state, toId)
  const taken = Math.min(amount, Math.max(0, from.score))
  from.score -= taken
  to.score += taken
  return [{ text: `${to.name} steals ${taken} points from ${from.name}` }]
}

// setScore(state, playerId, score) → events: set a player's score outright.
export function setScore(state, playerId, score) {
  if (!Number.isFinite(score)) throw new Error('setScore: score must be a number')
  const target = player(state, playerId)
  target.score = score
  return [{ text: `${target.name}'s score is now ${score}` }]
}

// addPointsToAll(state, amount, exceptId?) → events: add points to every player, optionally skipping one.
export function addPointsToAll(state, amount, exceptId) {
  return state.players.filter(p => p.id !== exceptId).flatMap(p => addPoints(state, p.id, amount))
}

// swapScores(state, aId, bId) → events: exchange two players' scores.
export function swapScores(state, aId, bId) {
  const a = player(state, aId), b = player(state, bId)
  ;[a.score, b.score] = [b.score, a.score]
  return [{ text: `${a.name} and ${b.name} swap scores` }]
}
