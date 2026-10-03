import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseRules, cardFace, GameConfigSchema, type Card, type CardView, type ClientMsg, type SavedCardMeta, type LearningNote, type LearningStatus, type Rules, type AgentVerdict, ReflectionSchema, type GameAgent, type GameConfig, type GameState, type HistoryEntry, type Phase, type RoomSnapshot, type ServerMsg, type ThreadEntry } from '@cards/shared'
import { composeCard, normalizeSavedCard } from './cards.ts'
import { Library } from './library.ts'
import { LearningStore, learningStats, renderReport } from './learning.ts'
import { mechanics } from './mechanics.ts'
import { interpretPlay, runEngine } from './engineHost.ts'
import { MockAgent } from './agent/mock.ts'
import { OpenCodeAgent } from './agent/opencode.ts'

export type Peer = { send: (message: ServerMsg) => void; room?: Room; playerId?: string; closed?: boolean }
type Seat = { id: string; name: string; token: string }
type SavedRoom = {
  code: string; config: GameConfig; phase: Phase; seats: Seat[]; cards: Card[];
  state: GameState | null; source: string; version: number; thread: ThreadEntry[];
  history: HistoryEntry[]; pendingCard: string | null; learning?: LearningStatus;
}
// `learning` runs reflections and the report in order, off the turn's critical path.
export type Room = SavedRoom & { peers: Map<string, Peer>; queue: Promise<void>; learningChain: Promise<void> }
const baseSource = await readFile(fileURLToPath(new URL('../../game/engine.mjs', import.meta.url)), 'utf8')

export class Rooms {
  readonly rooms = new Map<string, Room>()
  readonly library: Library
  readonly learningStore: LearningStore
  constructor(readonly config: GameConfig, readonly directory: string, readonly agent?: GameAgent, library?: Library) {
    this.library = library ?? new Library(path.join(directory, 'library'))
    this.learningStore = new LearningStore(path.join(directory, 'learning'))
  }

  private gameAgent(config: GameConfig): GameAgent {
    if (this.agent) return this.agent
    if (config.agent.provider === 'mock') return new MockAgent()
    if (process.env.CARDS_ALLOW_GENERATED_ENGINE !== 'trusted-local') throw new Error('OpenCode requires CARDS_ALLOW_GENERATED_ENGINE=trusted-local; generated engines are not safe for public deployment')
    return new OpenCodeAgent(config.agent)
  }

  async load() {
    await mkdir(this.directory, { recursive: true })
    for (const file of await readdir(this.directory)) {
      if (!/^[A-Z]{4}\.json$/.test(file)) continue
      const saved = JSON.parse(await readFile(path.join(this.directory, file), 'utf8')) as SavedRoom
      saved.config = GameConfigSchema.parse(saved.config)
      this.gameAgent(saved.config)
      const room: Room = { ...saved, peers: new Map(), queue: Promise.resolve(), learningChain: Promise.resolve() }
      this.rooms.set(room.code, room)
      if (room.pendingCard && room.state) {
        this.failedPlay(room, room.pendingCard, 'Server restarted during interpretation; no effects applied.')
        await this.save(room)
      }
      // A report interrupted by a restart is rebuilt from the notes on disk.
      if (room.learning?.report === 'pending') { room.learning.report = 'none'; this.finishLearning(room) }
    }
  }

  async save(room: Room) {
    const { peers: _peers, queue: _queue, learningChain: _learningChain, ...saved } = room
    const filename = path.join(this.directory, `${room.code}.json`)
    await writeFile(`${filename}.tmp`, JSON.stringify(saved), { mode: 0o600 })
    await rename(`${filename}.tmp`, filename)
  }

  private attach(peer: Peer, room: Room, seat: Seat) {
    if (peer.closed) throw new Error('Connection closed')
    if (peer.room) throw new Error('Already joined a room')
    const previous = room.peers.get(seat.id)
    if (previous) { previous.room = undefined; previous.playerId = undefined; previous.send({ type: 'error', message: 'Seat resumed on another connection' }) }
    peer.room = room; peer.playerId = seat.id; room.peers.set(seat.id, peer)
    peer.send({ type: 'joined', code: room.code, token: seat.token, playerId: seat.id })
    this.broadcast(room)
  }

  disconnect(peer: Peer) {
    peer.closed = true
    if (peer.room && peer.playerId && peer.room.peers.get(peer.playerId) === peer) {
      const room = peer.room; room.peers.delete(peer.playerId); peer.room = undefined; peer.playerId = undefined; this.broadcast(room)
    }
  }

  view(room: Room, id: string): RoomSnapshot {
    const view = (card: Card): CardView => ({ ...cardFace(card), imageUrl: `/rooms/${room.code}/cards/${card.id}?token=${encodeURIComponent(room.seats.find(s => s.id === id)!.token)}` })
    const hand = room.state?.players.find(p => p.id === id)?.hand ?? []
    return {
      code: room.code, phase: room.phase, config: room.config, youId: id,
      players: room.seats.map((seat, index) => ({ id: seat.id, name: seat.name, score: room.state?.players.find(p => p.id === seat.id)?.score ?? 0, handCount: room.state?.players.find(p => p.id === seat.id)?.hand.length ?? 0, cardsSubmitted: room.cards.filter(c => c.authorId === seat.id).length, connected: room.peers.has(seat.id), isHost: index === 0 })),
      hand: room.cards.filter(c => hand.includes(c.id)).map(view),
      myCards: room.phase === 'authoring' ? room.cards.filter(c => c.authorId === id).map(view) : [],
      turn: room.state ? { playerId: room.state.turn.playerId, number: room.state.turn.number } : null,
      rules: room.state?.rules ?? null, engineVersion: room.version, deckCount: room.state?.deck.length ?? 0,
      agentPending: room.pendingCard !== null, winnerId: room.state?.winnerId ?? null,
      gameCards: room.phase === 'ended' ? room.cards.map(view) : [],
      learning: room.config.mode === 'learning' ? room.learning ?? { notes: 0, report: 'none' } : null,
      thread: room.thread.map(entry => entry.kind === 'play' ? { ...entry, card: view(room.cards.find(c => c.id === entry.card.id)!) } : entry.kind === 'verdict' ? { ...entry, verdict: { ...entry.verdict, enginePatch: undefined } } : entry),
    }
  }

  broadcast(room: Room) { for (const [id, peer] of room.peers) peer.send({ type: 'state', snapshot: this.view(room, id) }) }
  seat(room: Room, token: string) {
    return room.seats.find(seat => {
      const left = Buffer.from(seat.token), right = Buffer.from(token)
      return left.length === right.length && timingSafeEqual(left, right)
    })
  }
  image(code: string, cardId: string, token: string) {
    const room = this.rooms.get(code), seat = room && this.seat(room, token)
    if (!room || !seat) return null
    const card = room.cards.find(c => c.id === cardId)
    const publicCard = room.thread.some(e => e.kind === 'play' && e.card.id === cardId)
    if (!card || !(publicCard || room.phase === 'ended' || (room.phase === 'authoring' && card.authorId === seat.id) || room.state?.players.find(p => p.id === seat.id)?.hand.includes(cardId))) return null
    return Buffer.from(card.png.slice('data:image/png;base64,'.length), 'base64')
  }

  async learningReport(code: string, token: string) {
    const room = this.rooms.get(code)
    if (!room || !this.seat(room, token) || room.learning?.report !== 'ready') return null
    return this.learningStore.report(code)
  }

  async libraryImage(code: string, name: string, token: string) {
    const room = this.rooms.get(code)
    if (!room || !this.seat(room, token)) return null
    return (await this.library.read(name))?.png ?? null
  }

  // Shared by local and server-library imports. Imported cards count toward the quota.
  private async importCard(room: Room, id: string, png: string, meta: SavedCardMeta) {
    if (room.phase !== 'authoring') throw new Error('Authoring has ended')
    if (room.cards.filter(c => c.authorId === id).length >= room.config.cardsPerPlayer) throw new Error('Card quota reached')
    if ((meta.title?.length ?? 0) > room.config.card.titleMaxChars || meta.text.length > room.config.card.maxChars) throw new Error('Saved card text is longer than this game allows')
    const normalized = await normalizeSavedCard(png, room.config.card)
    if (room.cards.some(c => c.png === normalized)) throw new Error('That card is already in this game')
    room.cards.push({ id: randomUUID(), authorId: id, title: meta.title, text: meta.text, png: normalized })
  }

  async handle(peer: Peer, message: ClientMsg): Promise<void> {
    if (peer.closed) throw new Error('Connection closed')
    if (message.type === 'createRoom') {
      if (peer.room) throw new Error('Already joined a room')
      const config = GameConfigSchema.parse({ ...this.config, ...message.configOverrides })
      this.gameAgent(config)
      let code: string
      do { code = Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join('') } while (this.rooms.has(code))
      const seat = { id: randomUUID(), name: message.name, token: randomBytes(32).toString('base64url') }
      const room: Room = { code, config, phase: 'authoring', seats: [seat], cards: [], state: null, source: baseSource, version: 1, thread: [], history: [], pendingCard: null, peers: new Map(), queue: Promise.resolve(), learningChain: Promise.resolve() }
      this.rooms.set(code, room)
      try { await this.save(room) } catch (error) { this.rooms.delete(code); throw error }
      this.attach(peer, room, seat); return
    }
    if (message.type === 'resume') {
      const room = this.rooms.get(message.code), seat = room && this.seat(room, message.token)
      if (!room || !seat) throw new Error('Invalid room or resume token')
      this.attach(peer, room, seat); return
    }
    const room = message.type === 'joinRoom' ? this.rooms.get(message.code) : peer.room
    if (!room) throw new Error('Room not found or not joined')
    const operation = room.queue.then(async () => {
      if (peer.closed) throw new Error('Connection closed')
      if (message.type === 'joinRoom') {
        if (peer.room) throw new Error('Already joined a room')
        if (room.phase !== 'authoring') throw new Error('Game already started')
        if (room.seats.length >= room.config.maxPlayers) throw new Error('Room is full')
        const seat = { id: randomUUID(), name: message.name, token: randomBytes(32).toString('base64url') }
        room.seats.push(seat); await this.save(room); this.attach(peer, room, seat); return
      }
      const id = peer.playerId
      if (!id || room.peers.get(id) !== peer) throw new Error('Seat is not authenticated')
      if (message.type === 'listLibrary') {
        const token = encodeURIComponent(room.seats.find(s => s.id === id)!.token)
        const cards = (await this.library.list()).map(({ name, title, text, authorName }) => ({ name, title, text, authorName, imageUrl: `/rooms/${room.code}/library/${name}?token=${token}` }))
        peer.send({ type: 'library', cards }); return
      }
      if (message.type === 'saveCards') {
        if (room.phase !== 'ended') throw new Error('Cards can be saved once the game is over')
        const cards = [...new Set(message.cardIds)].map(cardId => room.cards.find(c => c.id === cardId))
        if (cards.some(c => !c)) throw new Error('Unknown card')
        const names: string[] = []
        for (const card of cards as Card[]) names.push(await this.library.save(card, room.seats.find(s => s.id === card.authorId)?.name ?? 'unknown', room.code))
        peer.send({ type: 'cardsSaved', names }); return
      }
      if (message.type === 'say') {
        room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'chat', authorId: id, text: message.text })
      } else if (message.type === 'submitCard') {
        if (room.phase !== 'authoring') throw new Error('Authoring has ended')
        if (room.cards.filter(c => c.authorId === id).length >= room.config.cardsPerPlayer) throw new Error('Card quota reached')
        const png = await composeCard(message.card, room.config.card)
        room.cards.push({ id: randomUUID(), authorId: id, title: message.card.title, text: message.card.text, png })
      } else if (message.type === 'setMode') {
        if (id !== room.seats[0].id) throw new Error('Only the host can change the mode')
        if (room.phase !== 'authoring') throw new Error('The mode is fixed once the deck is dealt')
        room.config = { ...room.config, mode: message.mode }
      } else if (message.type === 'importCard') {
        await this.importCard(room, id, message.png, message.meta)
      } else if (message.type === 'importLibraryCard') {
        const saved = await this.library.read(message.name)
        if (!saved) throw new Error('Saved card not found')
        await this.importCard(room, id, `data:image/png;base64,${saved.png.toString('base64')}`, saved.meta)
      } else if (message.type === 'deleteCard') {
        if (room.phase !== 'authoring') throw new Error('Authoring has ended')
        const index = room.cards.findIndex(c => c.id === message.cardId && c.authorId === id)
        if (index < 0) throw new Error('Card not owned by you')
        room.cards.splice(index, 1)
      } else if (message.type === 'startGame') {
        if (id !== room.seats[0].id) throw new Error('Only the host can start')
        if (room.phase !== 'authoring') throw new Error('Game already started')
        if (room.seats.length < room.config.minPlayers || room.seats.some(s => room.cards.filter(c => c.authorId === s.id).length !== room.config.cardsPerPlayer)) throw new Error('Every player must submit their full quota and minimum players must join')
        const deck = room.cards.map(c => c.id)
        for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]] }
        room.state = { players: room.seats.map(s => ({ id: s.id, name: s.name, score: 0, hand: deck.splice(0, room.config.handSize) })), deck, discard: [], turn: { playerId: room.seats[randomInt(room.seats.length)].id, number: 1, playsThisTurn: 0 }, rules: baseRules(room.config.targetScore, room.config.handSize), vars: {}, winnerId: null }
        room.phase = 'play'
      } else if (message.type === 'playCard') {
        await this.play(room, id, message.cardId)
      }
      await this.save(room); this.broadcast(room)
    })
    room.queue = operation.catch(() => {})
    await operation
  }

  private failedPlay(room: Room, cardId: string, error: string) {
    const state = room.state!
    const player = state.players.find(p => p.hand.includes(cardId))!
    player.hand.splice(player.hand.indexOf(cardId), 1); state.discard.push(cardId)
    player.hand.push(...state.deck.splice(0, state.rules.drawAfterPlay))
    // Emergency progress is mechanical and deliberately applies no rule or scoring effects.
    const index = state.players.indexOf(player)
    for (let step = 1; step <= state.players.length; step++) {
      const next = state.players[((index + state.rules.direction * step) % state.players.length + state.players.length) % state.players.length]
      if (next.hand.length) { state.turn = { playerId: next.id, number: state.turn.number + 1, playsThisTurn: 0 }; break }
    }
    room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'verdict', cardId, verdict: { narration: 'Interpretation failed. Card discarded without effects; turn advanced.', effects: [], rulesPatch: {} }, engineChanged: false, engineError: error, events: [] })
    room.pendingCard = null
    if (!state.players.some(p => p.hand.length)) { room.phase = 'ended'; room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'system', text: 'No playable hands remain. Game ended without a winner.' }) }
  }

  private async play(room: Room, id: string, cardId: string) {
    const state = room.state, card = room.cards.find(c => c.id === cardId)
    if (room.phase !== 'play' || !state || room.pendingCard) throw new Error('Cannot play now')
    if (state.turn.playerId !== id || !state.players.find(p => p.id === id)?.hand.includes(cardId) || !card) throw new Error('Not your turn or card not in your hand')
    const validation = await runEngine(room.source, state, { playerId: id, card: cardFace(card), effects: [] }, room.config.agent.timeoutMs, false)
    if (!validation.valid.ok) throw new Error(validation.valid.reason ?? 'Play rejected')
    room.pendingCard = cardId
    room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'play', authorId: id, card: { ...cardFace(card), imageUrl: '' } })
    await this.save(room); this.broadcast(room)
    const started = Date.now(), rulesBefore = state.rules, turn = state.turn.number
    const outcome = await interpretPlay(this.gameAgent(room.config), { card, playerId: id, rules: state.rules, engineSource: room.source, state, history: room.history, mechanics: mechanics.catalog, playerNames: Object.fromEntries(room.seats.map(s => [s.id, s.name])) }, room.config.agent.maxRollbackRetries, room.config.agent.timeoutMs)
    const metrics = { durationMs: Date.now() - started, attempts: outcome.attempts, engineChanged: false, failed: true, engineError: outcome.error }
    const playerName = room.seats.find(s => s.id === id)!.name
    if (outcome.error !== undefined || !outcome.result?.result || !outcome.verdict) {
      this.failedPlay(room, cardId, outcome.error ?? 'Invalid result')
      this.observe(room, { turn, playerName, card, rulesBefore, rulesAfter: rulesBefore, verdict: null, metrics })
      return
    }
    const changed = room.source !== outcome.source
    room.source = outcome.source!; room.version = outcome.result.version; room.state = outcome.result.result.state; room.pendingCard = null
    room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'verdict', cardId, verdict: outcome.verdict, engineChanged: changed, events: outcome.result.result.events.map(e => e.text) })
    room.history.push({ turn: state.turn.number, playerName: room.seats.find(s => s.id === id)!.name, card: { title: card.title, text: card.text }, narration: outcome.verdict.narration })
    if (room.state.winnerId) room.phase = 'ended'
    else if (!room.state.players.some(p => p.hand.length)) { room.phase = 'ended'; room.thread.push({ id: randomUUID(), at: Date.now(), kind: 'system', text: 'No playable hands remain. Game ended without a winner.' }) }
    this.observe(room, { turn, playerName, card, rulesBefore, rulesAfter: room.state.rules, verdict: outcome.verdict, metrics: { ...metrics, engineChanged: changed, failed: false, engineError: undefined } })
  }

  // Learning mode: queue a note (and the agent's reflection) for this play, and the
  // report once the game is over. Never awaited by the turn itself.
  private observe(room: Room, play: { turn: number; playerName: string; card: Card; rulesBefore: Rules; rulesAfter: Rules; verdict: AgentVerdict | null; metrics: LearningNote['metrics'] }) {
    if (room.config.mode !== 'learning') return
    const agent = this.gameAgent(room.config)
    const { verdict, card } = play
    const rulesChanged = Object.keys(play.rulesAfter).filter(key => JSON.stringify(play.rulesAfter[key]) !== JSON.stringify(play.rulesBefore[key]))
    room.learningChain = room.learningChain.then(async () => {
      const note: LearningNote = {
        at: new Date().toISOString(), turn: play.turn, cardId: card.id, playerName: play.playerName, card: { title: card.title, text: card.text },
        effects: verdict?.effects.map(e => e.kind) ?? [], rulesChanged, metrics: play.metrics, reflection: null,
      }
      if (verdict && agent.reflect) {
        const { enginePatch, ...rest } = verdict
        try {
          note.reflection = ReflectionSchema.parse(await withTimeout(agent.reflect({ turn: play.turn, playerName: play.playerName, card: cardFace(card), rulesBefore: play.rulesBefore, rulesAfter: play.rulesAfter, verdict: rest, enginePatchChars: enginePatch?.length ?? 0, metrics: play.metrics, snippets: mechanics.names }), room.config.agent.timeoutMs))
        } catch (error) { note.reflectionError = error instanceof Error ? error.message : String(error) }
      }
      await this.learningStore.append(room.code, note)
      room.learning = { notes: (room.learning?.notes ?? 0) + 1, report: room.learning?.report ?? 'none' }
      this.broadcast(room)
    }).catch(error => console.error(`learning note for ${room.code} failed:`, error))
    if (room.phase === 'ended') this.finishLearning(room)
  }

  private finishLearning(room: Room) {
    if (room.config.mode !== 'learning' || (room.learning && room.learning.report !== 'none')) return
    room.learning = { notes: room.learning?.notes ?? 0, report: 'pending' }
    const agent = this.gameAgent(room.config)
    room.learningChain = room.learningChain.then(async () => {
      const notes = await this.learningStore.notes(room.code)
      const stats = learningStats(notes)
      let advice: string | null = null, adviceError: string | undefined
      if (agent.report) {
        try { advice = await withTimeout(agent.report({ gameCode: room.code, notes, stats }), room.config.agent.timeoutMs) } catch (error) { adviceError = error instanceof Error ? error.message : String(error) }
      }
      await this.learningStore.writeReport(room.code, renderReport(room.code, notes, stats, advice, adviceError))
      room.learning = { notes: notes.length, report: 'ready' }
    }).catch(error => {
      console.error(`learning report for ${room.code} failed:`, error)
      room.learning = { notes: room.learning?.notes ?? 0, report: 'failed' }
    }).then(() => {
      // Persist through the room queue so this never races a turn's save.
      room.queue = room.queue.then(() => this.save(room)).catch(() => {})
      this.broadcast(room)
    })
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Learning step timed out')), ms) })]).finally(() => clearTimeout(timer))
}
