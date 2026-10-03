# 1000 Blank Agent Cards — Plan

A multiplayer, chat-room twist on [1000 Blank White Cards](https://en.wikipedia.org/wiki/1000_Blank_White_Cards).
Players draw black-and-white cards, the deck decides the game, and a central AI agent
interprets each played card against the current rules — rewriting the ruleset and,
when a card demands it, the game engine itself.

## The loop

1. **Setup** — host creates a room, gets a 4-letter code, shares it.
2. **Authoring** — each player draws `cardsPerPlayer` cards: black pen / white eraser on
   canvas, or import an image (hard-thresholded to 1-bit), plus a short capped text.
3. **Deal** — all cards from all players go into one shared deck, shuffled, `handSize`
   dealt to each human. The agent never holds cards.
4. **Play** — a random player goes first, then turns rotate. On your turn you play any
   card from your hand. It is revealed to the room and to the agent.
5. **Interpret** — the agent reads the card against the current ruleset and either
   applies an immediate effect, amends the rules, or patches the engine. No
   back-and-forth with the player; it decides and the game continues.
6. **Win** — first player to `targetScore`. Base rules: score points, rotate turns,
   one card per turn. Cards can change any of this.

Base rules are only a starting point. `rules.json` and `engine.mjs` are both
agent-owned at runtime.

## Architecture

Everything runs on one Freestyle VM. The UI, game server, and agent runtime are
co-located; the agent's only write path is `game/engine.mjs`.

```
VM  vm-6a42b1427fa04e31b3e391db31e71f11  ("hackathon-drive", Ubuntu 24.04, 4 vCPU / 8 GiB)
│
├── opencode serve --hostname 127.0.0.1 --port 4096
│     model: opencode/space-bunny-free
│     cwd:   game/          ← so its file tools can only see the engine
│
├── game server (Node + ws)  ──@opencode-ai/sdk──>  opencode serve
│     owns: phases, hands, deck, scores, rules.json, engine.mjs, rules.log
│
└── web (Next.js)  ←── websocket ──>  game server
      card studio, game room, assistant-ui chat
```

`opencode serve` binds to localhost only. Players never reach it directly.

### Why one agent-owned file

The agent is allowed to re-code the game. That is only safe if the blast radius is
one file. `engine.mjs` holds *all* rule logic; the server holds only mechanical
concerns (who is in the room, whose turn it is, which cards exist). So a badly
interpreted card can produce a strange game but cannot corrupt the room.

## Repo layout

```
game.config.json          all tunables (see below)
shared/                   types + zod schemas, imported by server AND web
  card.ts  rules.ts  protocol.ts  config.ts
game/
  engine.mjs              ← ALL rule logic. agent-owned. hot-swapped.
  rules.json              ← current ruleset. agent-owned.
  state.json              scores, turn, hands, deck. server-owned.
  rules.log               append-only: every accepted agent change
server/
  index.ts                http + ws
  phases.ts               lobby → authoring → deal → play → win
  engineHost.ts           load / validate / swap engine, git commit, rollback
  agent/
    adapter.ts            interface both agents implement
    mock.ts               scripted, for local dev
    opencode.ts           real, via @opencode-ai/sdk
    prompt.ts             system prompt + propose_rules tool schema
web/
  app/                    routes: /, /room/[code]/studio, /room/[code]/play
  components/studio/      canvas, pen, import, text cap
  components/game/        hand, card, scores, turn indicator
  components/chat/        assistant-ui thread + generative card components
```

## Contracts (M0 — build this first, everything else depends on it)

M0 is implemented and verified in `shared/`. Use `shared/src/index.ts` exports and
`shared/README.md` as the authoritative handoff; the examples below are the original
planning sketches. Shared type-checking and all six contract tests pass. M1 can begin.

### game.config.json

```jsonc
{
  "maxPlayers": 6,
  "minPlayers": 2,
  "cardsPerPlayer": 4,
  "handSize": 3,
  "targetScore": 100,
  "card": { "widthPx": 480, "heightPx": 720, "maxChars": 140, "titleMaxChars": 24 },
  "agent": { "provider": "mock", "maxRollbackRetries": 1, "timeoutMs": 60000 }
}
```

Every number the game uses lives here. No magic numbers in code.

### Card model

```ts
type Card = {
  id: string
  authorId: string
  text: string        // ≤ card.maxChars
  title?: string      // ≤ card.titleMaxChars
  png: string         // data URL, the final composited card, text baked in
}
```

Text is composited into the PNG **server-side**. The agent reads the exact same image
the humans see — no second interpretation path.

### Protocol

Client → server:

| message | payload |
|---|---|
| `createRoom` | `{ configOverrides? }` |
| `joinRoom` | `{ code, name }` |
| `submitCard` | `{ card }` |
| `readyUp` | `{}` |
| `playCard` | `{ cardId }` |

Server → client: `state` (full snapshot: phase, players, scores, turn, your hand,
current rules, rules history) and `agentThinking` / `agentVerdict` for pending turns.

### Engine interface

`engine.mjs` default-exports exactly this. The server calls it; it never calls back.

```js
export const meta = { version: 1 }
export function validatePlay(state, card)  // → { ok: boolean, reason?: string }
export function applyPlay(state, card)     // → { state, events: [] }
export function checkWin(state)             // → { winnerId: string | null }
```

The server deep-clones `state.json`, calls `applyPlay`, and commits the result. If any
of the three throws, the clone is discarded and the turn is retried.

### Agent adapter

```ts
interface GameAgent {
  interpret(input: {
    card: Card
    rules: Rules
    engineSource: string
    state: State
    history: HistoryEntry[]
  }): Promise<{ narration: string; rulesPatch: object; enginePatch?: string }>
}
```

`mock.ts` and `opencode.ts` both implement this. The rest of the server never knows
which is active.

### The single tool: `propose_rules`

The model gets **one** tool, not `edit`/`bash`. Free-form multi-file surgery is
unreliable on a small free model, and a schema'd door is sandboxed by construction.

```jsonc
{
  "name": "propose_rules",
  "arguments": {
    "narration": "string, shown in chat — what the card does and why",
    "rulesPatch": "object, shallow-merged into rules.json",
    "enginePatch": "string, optional full replacement of engine.mjs"
  }
}
```

Apply pipeline, in `engineHost.ts`:

1. Write candidate engine to `engine.candidate.mjs`.
2. `import()` it in a **child process** with a timeout. It must export `meta`,
   `validatePlay`, `applyPlay`, `checkWin`, and must load standalone.
3. Throw → discard, re-prompt once with the error text. Throw again → keep last-good
   engine, agent still gets its `narration` (the card still does *something*).
4. Success → swap in, append to `rules.log`, `git commit` in `game/`.

Step 3 matters: a free model will sometimes emit broken code, and the game must not
stall on it.

## Milestones

| # | Deliverable | Owner | Depends on |
|---|---|---|---|
| **M0** | `shared/` schemas, config file, protocol types, agent adapter interface | Agent A | — |
| **M1** | Game server: phases, base `engine.mjs`, engineHost validate/swap/rollback, mock agent | Agent A | M0 |
| **M2** | Card studio: canvas, 1-bit import, char-capped text, quota + hand views | Agent B | M0 |
| **M3** | Game room: assistant-ui chat, room codes, card components, turn/win states | Agent C | M0 |
| **M4** | `opencode.ts` adapter, `prompt.ts`, `opencode serve` on the VM | A + C | M1 |
| **M5** | Deploy to `hackathon-drive`, player auth, persistence, key rotation | A + C | M1–M4 |
| **M6** | End-of-game card saving + import into new games | Agent (branch `m6-save-cards`) | M1–M3 |
| **M7** | Fast mode / learning mode, learning reports, reusable mechanic snippets | Agent (branch `m7-modes`) | M4 |

M1, M2, M3 run in parallel once M0 lands. M6 and M7 are independent of each other.

### Per-milestone detail

**M0** — no UI, no server. Just the schemas and interfaces, committed first so the
other agents can branch against them.

**M1** — playable with the mock agent. Must support: join, quota gating (play cannot
start until every player has submitted their full quota), shuffle+deal, turn
rotation from a random starter, one card per turn, score, win at `targetScore`,
rollback on a bad agent patch.

**M2** — canvas with black pen and white eraser (eraser paints white, it is not a
compositing `clearRect` — it has to actually erase ink to white so the card stays
opaque). Image import thresholds to 1-bit on the client so imports obey the same
constraint as drawing. Live char counter, hard cap.
*Status:* implemented in `web/app/room/[code]/studio` and verified against the
real M1 server, including server-composited images.

**M3** — assistant-ui as the thread. Card plays render as card components inline
(generative UI), not as image dumps. One shared thread per room; players see each
other's messages and the agent's verdicts.
*Status:* implemented at `web/app/room/[code]/play`. A two-player browser test against
the real M1 server with the mock agent passed: authoring, dealing, chat, six plays,
a win, and reconnect. Details are in `web/README.md`.

**M4** — `opencode serve` with cwd pinned to `game/`. Needs a credential on the VM
(see Open items). Session per turn or one long-lived session — one long-lived
session is cheaper and gives the agent memory of the game so far.

**M5** — provision script against the Freestyle API, firewall rules, a public URL,
per-player access tokens so nobody can impersonate a seat, state persistence so a
reconnect doesn't lose the game.
*Status:* protected mock deployment is running on the existing VM via systemd;
frontend is an independent production snapshot and OpenCode is offline in a private
network namespace. See `deploy/README.md` for the port-8080 Coshell preview,
lifecycle, verified restart/reconnect, limits, and remaining public/sandbox gaps.
No VM provisioning or key rotation was needed/performed. Freestyle rotation awaits
explicit scoped confirmation because existing Coshell infrastructure may use it.

**M6 — Save liked cards.** When the game ends (decided by `checkWin` / the agent, not
a fixed screen), each player gets a grid of every card played or dealt in that game.
Clicking a card toggles it as saved. On confirm, the player chooses where to save:
- **Local** — download to their machine (zip if more than one card).
- **Server** — store in a shared card library on the VM.

File convention: each saved card is a pair with the same base name and different
extensions.
```
<title-slug>--<cardId>.png    the composited card image (text baked in)
<title-slug>--<cardId>.json   { format: 1, id, title, text, authorName, savedAt, gameCode }
```
Untitled cards use `untitled` as the slug. The `.json` is the text half: it keeps the
title and text separate so the importer doesn't have to OCR the PNG.

Import: in the card studio, add "Import saved cards". It accepts pairs from the server
library or a local upload (loose files or the zip). Imported cards count toward
`cardsPerPlayer`. Validate them with the same zod schemas as new cards, and reject a
`.png` with no matching `.json`, or the reverse.
Open question: should imported cards be allowed to exceed the quota?

*Status:* implemented on branch `m6-save-cards`. Not merged or deployed yet.
- The convention and schemas are in `shared/src/library.ts`. New protocol messages:
  `saveCards`, `listLibrary`, `importCard`, `importLibraryCard`, with `library` and
  `cardsSaved` replies. `RoomSnapshot.gameCards` lists every card once the game ends.
- The server library is `<ROOM_DATA_DIR>/library/`, which is
  `/var/lib/cards-game/rooms/library` on the VM. It's shared by every room, capped at
  1000 cards, and its images are served at `/rooms/:code/library/:name` for seated
  players, so the proxy needs no changes. See `server/src/library.ts`.
- Imported PNGs must be exactly the card size. They're re-thresholded to 1-bit, and a
  card already in the room is rejected as a duplicate.
- Once the game ends, every card in it is visible to every player, including unplayed
  hands and the deck.
- Image routes now send `Access-Control-Allow-Origin: *`. Access is still controlled by
  the token in the URL. This lets the browser download images when the web app and
  game server are on different ports.
- Author credit is only kept in the saved `.json`. Inside a game, an imported card
  belongs to whoever imported it, and saving it again records that player as the
  author.
- Web: `components/game/SaveCards.tsx` is the end-of-game grid with download and
  save-to-server. `components/studio/ImportCards.tsx` is the importer, which reads
  server-library cards, loose files, and zip files (stored or deflated). Zip support is
  in `web/lib/zip.ts`.
- Verified by 4 server tests, 5 web tests, and a Playwright run against a local server
  on a spare port: grid, multi-card zip, single-card pair, save to server, library
  import, zip import that stops at the quota. `unzip -t` passes on the downloaded zip.

**M7 — Fast mode and learning mode.** Add `"mode": "fast" | "learning"` to
`game.config.json`. The host can override it when creating a room.
- **Fast** is the current behavior, tuned for speed. This is the mode M7 is trying to
  make faster.
- **Learning** — after each card's verdict, the agent runs a second reflection pass
  outside the turn's critical path. It looks at the card, its own narration and patch,
  how the change fit with the existing rules (conflicts, overrides, dead rules), how
  long the turn took, and whether a rollback happened.
- **End-of-game report** — recurring mechanics, slow or failed turns, prompt and
  engine friction, and specific advice for making fast mode faster.
- **Mechanic snippets** — a curated, human-reviewed library of common mechanics at
  `game/mechanics/*.mjs` (steal points, skip turns, extra turns, swap hands, timed
  effects, ...). Engine code the agent writes can `import { stealPoints } from
  'mechanics'` and use whichever snippets help, so a rewrite calls a known-good
  function instead of re-deriving the logic. Cards nothing covers still get brand-new
  code, exactly as before. Snippets are read-only to the agent, so the "agent writes
  one file" blast radius stays the same. Learning reports name the mechanics that
  recur; those become new snippets.

*Status:* implemented on branch `m7-modes`: modes, learning notes, the report, and a
starter snippet library.
- `mode` lives in `game.config.json` (default `fast`). It can be overridden in
  `createRoom`, and the host can switch it in the studio before the deal
  (`setMode`). Saved rooms with no mode load as fast.
- Notes go to `<ROOM_DATA_DIR>/learning/<CODE>.jsonl`, not `game/`. `game/` is the
  agent's working directory, and room data already lives under `ROOM_DATA_DIR`.
  The report is `<CODE>-report.md` in the same place. Players can read it from the
  game-over screen; it's served at `/rooms/:code/learning-report` and requires a
  seat token.
- The server measures each note's metrics itself: duration, attempts, engine rewrite,
  failure. The agent's reflection is optional (`GameAgent.reflect` / `report`). If
  that step is missing or fails, the note and the numbers-only report still get
  written. Reflections run in order on a per-room chain and never delay the next
  turn.
- The OpenCode agent's reflect and report steps are text-only throwaway sessions with
  every permission denied, the same setup as `interpret`.
- Verified by 10 server tests and a Playwright run with the mock agent. Not yet run
  against the real Space Bunny model.
- Snippets: the engine sandbox still rejects every import except `mechanics` and
  `mechanics/<file>`. The worker serves those from source the server loads at
  startup, so engine code still can't read the disk. The agent gets a one-line
  signature catalog (`AgentInput.mechanics`), and its prompt says to prefer snippets
  over hand-written logic. The server refuses to start if a snippet is undocumented,
  imports anything, or reuses a name. The library is append-only, because saved room
  engines import it by name. Rules are in `game/README.md`. It starts with 22
  functions in `points`, `cards`, `turns`, `state`. 8 tests cover the snippets, the
  sandbox, and a full room where a generated engine imports snippets.

## Open items

- **opencode credential on the VM.** This chat's model access comes from coshell's
  proxy; `opencode auth list` shows 0 local credentials. `opencode serve` on the VM
  needs its own login — either a human runs `opencode auth login` on the VM, or a
  gateway key gets planted in its `auth.json`. **Blocks M4.**
- **Free-tier latency.** `space-bunny-free` will be slow and rate-limited. A turn
  with an image plus a code patch could take 30–90s. The UI needs a deliberate
  "agent is interpreting" beat — treat it as part of the drama, not a loading state.
  Provider stays behind `agent.provider` in config so a real key is a one-line swap.
- **Keys pasted in chat.** A Freestyle API key and a rejected token were both pasted
  into the coshell chat in plaintext. Rotate before the demo.

## Non-goals

- No accounts, no matchmaking. The only thing that persists across games is saved
  cards (M6) and learning notes (M7). Game state does not.
- The agent never holds cards and never plays.
- No moderation on card text — it's a room of friends drawing rude things.
