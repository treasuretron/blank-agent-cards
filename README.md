# 1000 Blank Agent Cards

Draw the cards. The deck decides the game. An agent rewrites the rules.

A multiplayer, chat-room twist on [1000 Blank White Cards](https://en.wikipedia.org/wiki/1000_Blank_White_Cards).
Everyone draws a few black-and-white cards, they're shuffled into one shared deck, and
players take turns playing them. A central AI agent reads each played card against the
current rules and decides what it does: score points, amend the rules, or rewrite the
game engine itself.

## How a game works

1. **Setup**: the host creates a room and shares its 4-letter code.
2. **Authoring**: each player draws their cards (black pen and white eraser, or an
   imported image converted to 1-bit) and adds a short title and text.
3. **Deal**: all cards go into one deck, shuffled and dealt to each player.
4. **Play**: players take turns playing one card from their hand. Each play is revealed
   to the room and to the agent.
5. **Interpret**: the agent applies the card. It may change `rules.json` or replace
   `engine.mjs`; broken engine patches are rejected and rolled back.
6. **Win**: first to the target score, unless a card says otherwise.

Out of ideas, or out of cards? Ask the agent to draw some. In the studio its cards
fill your quota; mid-game they're shuffled into the deck, and a game that ran dry
starts again.

## Layout

```
shared/   types, zod schemas and protocol, used by server and web
server/   Node + ws game server: rooms, phases, engine host, agent adapters
web/      Next.js app: home, card studio, game room
game/     engine.mjs, the seed rule engine the agent is allowed to rewrite
deploy/   systemd units and scripts for the demo VM
game.config.json   every tunable (players, hand size, target score, card size, agent)
PLAN.md   design, contracts and milestones
```

## Running locally

Requires Node 24.

```sh
npm install
npm run dev:server     # game server on http://localhost:8787
npm run dev:web        # web app on http://localhost:3000
```

The agent defaults to a scripted mock (`"provider": "mock"` in `game.config.json`), so
you can play without any model credentials.

Tests and type-checking:

```sh
npm test               # server tests
npm test -w web        # web unit tests
npm run typecheck
```

More detail lives in each package's README: [server](server/README.md),
[web](web/README.md), [shared](shared/README.md), [game](game/README.md),
[deploy](deploy/README.md).
