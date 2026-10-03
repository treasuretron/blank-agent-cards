// Reviewed mechanics: moving cards. Cards only ever move between hands, deck and
// discard, so the server's "no lost or invented cards" check always holds.
// Inside applyPlay, remove the card being played from its hand *before* calling
// anything here that moves hand cards, or it could be passed or discarded twice.

const hand = (state, id) => {
  const found = state.players.find(p => p.id === id)
  if (!found) throw new Error(`Unknown player: ${id}`)
  return found
}

// drawCards(state, playerId, count) → events: draw from the top of the deck; draws fewer if the deck runs out.
export function drawCards(state, playerId, count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('drawCards: count must be a non-negative integer')
  const target = hand(state, playerId)
  const drawn = state.deck.splice(0, count)
  target.hand.push(...drawn)
  return [{ text: `${target.name} draws ${drawn.length} card${drawn.length === 1 ? '' : 's'}` }]
}

// discardRandom(state, playerId, count) → events: discard random cards from a player's hand.
export function discardRandom(state, playerId, count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('discardRandom: count must be a non-negative integer')
  const target = hand(state, playerId)
  let discarded = 0
  for (; discarded < count && target.hand.length; discarded++) {
    state.discard.push(...target.hand.splice(Math.floor(Math.random() * target.hand.length), 1))
  }
  return [{ text: `${target.name} discards ${discarded} card${discarded === 1 ? '' : 's'}` }]
}

// giveRandomCard(state, fromId, toId) → events: move one random card from one hand to another.
export function giveRandomCard(state, fromId, toId) {
  const from = hand(state, fromId), to = hand(state, toId)
  if (!from.hand.length) return [{ text: `${from.name} has no cards to give` }]
  to.hand.push(...from.hand.splice(Math.floor(Math.random() * from.hand.length), 1))
  return [{ text: `${from.name} gives a card to ${to.name}` }]
}

// swapHands(state, aId, bId) → events: exchange two players' entire hands.
export function swapHands(state, aId, bId) {
  const a = hand(state, aId), b = hand(state, bId)
  ;[a.hand, b.hand] = [b.hand, a.hand]
  return [{ text: `${a.name} and ${b.name} swap hands` }]
}

// recycleDiscard(state) → events: shuffle the discard pile back under the deck.
export function recycleDiscard(state) {
  const cards = state.discard.splice(0)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  state.deck.push(...cards)
  return [{ text: `${cards.length} discarded cards shuffled back into the deck` }]
}
