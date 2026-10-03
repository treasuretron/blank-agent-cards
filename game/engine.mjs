export const meta = { version: 1 }

export function validatePlay(state, play) {
  if (state.winnerId) return { ok: false, reason: 'Game has ended' }
  if (state.turn.playerId !== play.playerId) return { ok: false, reason: 'Not your turn' }
  const player = state.players.find(p => p.id === play.playerId)
  if (!player?.hand.includes(play.card.id)) return { ok: false, reason: 'Card is not in your hand' }
  return { ok: true }
}

export function checkWin(state) {
  return { winnerId: state.players.find(p => p.score >= state.rules.targetScore)?.id ?? null }
}

export function applyPlay(state, play) {
  const validation = validatePlay(state, play)
  if (!validation.ok) throw new Error(validation.reason)
  const player = state.players.find(p => p.id === play.playerId)
  const events = []
  let skip = 0
  for (const effect of play.effects) {
    const target = state.players.find(p => p.id === (effect.target ?? play.playerId))
    if (effect.kind === 'score') {
      if (!target || !Number.isFinite(effect.amount)) throw new Error('Invalid score effect')
      target.score += effect.amount
      events.push({ text: `${target.name}: ${effect.amount >= 0 ? '+' : ''}${effect.amount} points` })
    } else if (effect.kind === 'draw') {
      if (!target || !Number.isInteger(effect.amount) || effect.amount < 0) throw new Error('Invalid draw effect')
      target.hand.push(...state.deck.splice(0, effect.amount))
    } else if (effect.kind === 'reverse') {
      state.rules.direction *= -1
    } else if (effect.kind === 'skip') {
      if (!Number.isInteger(effect.amount ?? 1) || (effect.amount ?? 1) < 0) throw new Error('Invalid skip effect')
      skip += effect.amount ?? 1
    } else throw new Error(`Unknown effect: ${effect.kind}`)
  }
  player.hand.splice(player.hand.indexOf(play.card.id), 1)
  state.discard.push(play.card.id)
  player.hand.push(...state.deck.splice(0, state.rules.drawAfterPlay))
  state.winnerId = checkWin(state).winnerId
  state.turn.playsThisTurn++
  if (!state.winnerId && (state.turn.playsThisTurn >= state.rules.cardsPerTurn || !player.hand.length)) {
    const index = state.players.indexOf(player)
    for (let step = 1 + skip; step <= state.players.length + skip; step++) {
      const next = state.players[((index + state.rules.direction * step) % state.players.length + state.players.length) % state.players.length]
      if (next.hand.length) {
        state.turn = { playerId: next.id, number: state.turn.number + 1, playsThisTurn: 0 }
        break
      }
    }
  }
  return { state, events }
}
