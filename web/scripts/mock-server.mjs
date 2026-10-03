// Dev-only stand-in for the M1 game server, so the studio can be exercised
// before the real server exists. Implements just enough of the @cards/shared
// protocol for authoring: create/join/resume, submit/delete cards, startGame.
// No engine, no agent, no compositing (card images are the raw art).
//
//   npm run mock-server -w web     # ws + http on :8787

import { randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { WebSocketServer } from "ws"

const config = JSON.parse(readFileSync(new URL("../../game.config.json", import.meta.url), "utf8"))
const port = Number(process.env.PORT ?? config.server.port)

const rooms = new Map() // code -> { code, phase, players: [], cards: Map, sockets: Map<playerId, Set<ws>> }

const newCode = () => {
  let code
  do code = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")
  while (rooms.has(code))
  return code
}

function view(room, card) {
  return { id: card.id, authorId: card.authorId, title: card.title, text: card.text, imageUrl: `/cards/${room.code}/${card.id}.png` }
}

function snapshot(room, player) {
  const mine = [...room.cards.values()].filter((c) => c.authorId === player.id)
  return {
    code: room.code,
    phase: room.phase,
    config,
    youId: player.id,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: 0,
      handCount: p.hand.length,
      cardsSubmitted: [...room.cards.values()].filter((c) => c.authorId === p.id).length,
      connected: (room.sockets.get(p.id)?.size ?? 0) > 0,
      isHost: p.id === room.hostId,
    })),
    hand: player.hand.map((id) => view(room, room.cards.get(id))),
    myCards: room.phase === "authoring" ? mine.map((c) => view(room, c)) : [],
    turn: null,
    rules: null,
    engineVersion: 0,
    deckCount: room.deck.length,
    agentPending: false,
    winnerId: null,
    thread: [],
  }
}

function broadcast(room) {
  for (const p of room.players)
    for (const ws of room.sockets.get(p.id) ?? []) ws.send(JSON.stringify({ type: "state", snapshot: snapshot(room, p) }))
}

function seat(ws, room, player) {
  ws.seat = { room, player }
  if (!room.sockets.has(player.id)) room.sockets.set(player.id, new Set())
  room.sockets.get(player.id).add(ws)
}

function addPlayer(ws, room, name) {
  if (room.players.length >= config.maxPlayers) throw new Error("Room is full")
  const player = { id: randomUUID(), name: name.trim(), token: randomBytes(16).toString("hex"), hand: [] }
  room.players.push(player)
  seat(ws, room, player)
  ws.send(JSON.stringify({ type: "joined", code: room.code, token: player.token, playerId: player.id }))
  broadcast(room)
}

function handle(ws, msg) {
  const s = ws.seat
  switch (msg.type) {
    case "createRoom": {
      const room = { code: newCode(), phase: "authoring", players: [], cards: new Map(), sockets: new Map(), deck: [], hostId: null }
      rooms.set(room.code, room)
      addPlayer(ws, room, msg.name)
      room.hostId = room.players[0].id
      return broadcast(room)
    }
    case "joinRoom": {
      const room = rooms.get(msg.code)
      if (!room) throw new Error(`No room ${msg.code}`)
      if (room.phase !== "authoring") throw new Error("That game has already started")
      return addPlayer(ws, room, msg.name)
    }
    case "resume": {
      const room = rooms.get(msg.code)
      const player = room?.players.find((p) => p.token === msg.token)
      if (!player) throw new Error("That seat is no longer valid. Join again.")
      seat(ws, room, player)
      return broadcast(room)
    }
    case "submitCard": {
      if (!s) throw new Error("Not in a room")
      const { room, player } = s
      if (room.phase !== "authoring") throw new Error("Authoring is closed")
      const mine = [...room.cards.values()].filter((c) => c.authorId === player.id)
      if (mine.length >= config.cardsPerPlayer) throw new Error("You've already made all your cards")
      const { title, text, art } = msg.card ?? {}
      if (typeof art !== "string" || !art.startsWith("data:image/png;base64,")) throw new Error("Bad art")
      if ((title ?? "").length > config.card.titleMaxChars || (text ?? "").length > config.card.maxChars) throw new Error("Too long")
      const id = randomUUID()
      room.cards.set(id, { id, authorId: player.id, title, text: text ?? "", png: Buffer.from(art.split(",")[1], "base64") })
      return broadcast(room)
    }
    case "deleteCard": {
      if (!s) throw new Error("Not in a room")
      const card = s.room.cards.get(msg.cardId)
      if (!card || card.authorId !== s.player.id || s.room.phase !== "authoring") throw new Error("Can't delete that card")
      s.room.cards.delete(card.id)
      return broadcast(s.room)
    }
    case "startGame": {
      if (!s) throw new Error("Not in a room")
      const { room, player } = s
      if (player.id !== room.hostId) throw new Error("Only the host can deal")
      if (room.players.length < config.minPlayers) throw new Error("Not enough players")
      for (const p of room.players)
        if ([...room.cards.values()].filter((c) => c.authorId === p.id).length < config.cardsPerPlayer)
          throw new Error(`${p.name} hasn't finished their cards`)
      room.deck = [...room.cards.keys()].sort(() => Math.random() - 0.5)
      for (const p of room.players) p.hand = room.deck.splice(0, config.handSize)
      room.phase = "play"
      return broadcast(room)
    }
    default:
      throw new Error(`Mock server doesn't handle ${msg.type}`)
  }
}

const http = createServer((req, res) => {
  // No authorization here: the real server must check the recipient.
  const m = /^\/cards\/([A-Z]{4})\/([\w-]+)\.png/.exec(req.url ?? "")
  const card = m && rooms.get(m[1])?.cards.get(m[2])
  if (!card) return res.writeHead(404).end()
  res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" }).end(card.png)
})

const wss = new WebSocketServer({ server: http })
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    try {
      handle(ws, JSON.parse(String(data)))
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) }))
    }
  })
  ws.on("close", () => {
    const s = ws.seat
    if (!s) return
    s.room.sockets.get(s.player.id)?.delete(ws)
    broadcast(s.room)
  })
})

http.listen(port, () => console.log(`mock game server on :${port}`))
