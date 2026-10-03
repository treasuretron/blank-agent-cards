# web — card studio (M2) and game room (M3)

Next.js 16 app.

- `/`: create a room or join one by code.
- `/room/[code]/studio` (M2): draw cards and fill your quota. The host deals from here.
- `/room/[code]/play` (M3): the table, with the shared thread, scores, rules,
  your hand, and turn/win states. Everyone moves here automatically when the
  host deals. During authoring it redirects back to the studio.

Shared links to either page show a join form if this browser has no seat in that room.

```sh
npm run dev:server            # real game server (M1) on :8787
npm run dev -w web            # http://localhost:3000, talks to ws://<host>:8787/ws
npm run mock-server -w web    # stand-in game server on :8787 (until M1 lands)
npm test -w web               # bitmap + thread-mapping unit tests
npm run typecheck -w web
```

Point the app at a server with `NEXT_PUBLIC_SERVER_URL=https://host:port`
(or just `NEXT_PUBLIC_SERVER_PORT`). The default is the page's hostname on port 8787.

## What's here

- `lib/bitmap.ts`: all pixel logic, with no DOM. The art is a `Uint8Array` of
  ink/paper. The pen and eraser stamp discs into it, and the eraser writes paper
  (white) rather than clearing pixels. Imports go through grayscale (alpha over
  white), contain-fit on white, then threshold (Otsu default, adjustable) or
  Floyd–Steinberg dither. The exported PNG is opaque pure black/white.
- `components/studio/ArtBoard.tsx`: canvas, pen/eraser, 4 brush sizes, undo/redo
  (Ctrl+Z / Ctrl+Shift+Z), clear, and import by file picker, drag-drop, or paste.
- `components/studio/CappedField.tsx`: live counter with a hard cap
  (`maxLength`, plus a slice as a fallback), counted in UTF-16 units the same way zod's `.max()` counts.
- `components/cards/`: `CardTile` (server image with a text fallback),
  `EmptySlot`, `CardPreview`. M3 can reuse these.
- `lib/room.tsx`: `RoomProvider` / `useRoom()`. One websocket per tab handles
  `createRoom` / `joinRoom` / `resume`. It keeps seat tokens in `localStorage`
  under `cards:seat:<CODE>`, reconnects with backoff, and exposes the latest
  `RoomSnapshot`. M3 should use this rather than open a second socket.
- `lib/thread.ts`: maps `RoomSnapshot.thread` onto assistant-ui messages.
  Chat and plays become `user` messages tagged with their author, and verdicts
  become `assistant` messages. Cards and verdicts are `data` parts, so they
  render as components. A failed interpretation (`engineError`) is shown as
  "the card fizzled", and its proposed effects and rules are never displayed.
  While `agentPending` is set, a synthetic running message is appended.
- `components/chat/RoomThread.tsx`: assistant-ui `useExternalStoreRuntime`
  over server snapshots. The composer sends `say`. The thread is never marked
  "running", so people can keep chatting while the agent thinks.
- `components/game/`: `Scoreboard` (progress toward the *current*
  `rules.targetScore`, turn marker, hand counts), `RulesPanel` (known fields,
  invented keys, notes, engine version), `Hand` (select, then play; disabled off-turn
  or while the agent is pending), `GameOver`.
- `components/room/RoomGate.tsx`: handles resume, join-from-link, and connecting for any room page.
- `scripts/mock-server.mjs`: dev-only and unauthenticated. No engine, no
  compositing.

## Integration notes

- The client connects to `<server>/ws`. Card `imageUrl`s are resolved against the game
  server origin and already carry the recipient's token (M1 does this).
- The server binds one seat per connection, so `createRoom`/`joinRoom`/`resume`
  for a different room opens a fresh socket.
- A submit counts as accepted when `myCards.length` grows. Rejections arrive as `error`.
- Art is a square `card.widthPx × card.widthPx` PNG. The server currently stretches it into a
  slightly non-square art box (`server/src/cards.ts`). That's a known cosmetic issue, about 5%.
