# M1 Game Server

Requires Node 24. From the repository root:

```sh
npm install --workspace @cards/server --include-workspace-root
npm run dev:server
npm test -w @cards/server
npm run typecheck -w @cards/server
```

The default address is `http://localhost:8787`. `HOST` and `PORT` override the listener;
`ROOM_DATA_DIR` overrides the default `game/rooms` persistence directory. Use one server
process per persistence directory. There are no automatic git commits.

## Integration

Use the authoritative `@cards/shared` protocol without additional message types.

- Websocket: `ws://localhost:8787/ws` (use `wss` behind a TLS reverse proxy).
- Health check: `GET /health`, returns `{ "ok": true }`.
- Card images: `GET /rooms/:code/cards/:cardId`, authenticated by `Authorization: Bearer <seat-token>` or `?token=<seat-token>`.
- `createRoom` needs `name`, optionally `configOverrides`. The creator is the host.
- `joinRoom` needs uppercase four-letter `code` and `name`; new seats are permitted only during authoring.
- `joined` is sent only to the seat's connection. Persist its `code`, `token`, and `playerId` locally; send `resume` with code and token after reconnecting. A resume replaces any previous connection for that seat.
- `submitCard` uses `{ title?, text, art: "data:image/png;base64,..." }`. `deleteCard` removes an owned draft during authoring.
- Only the host can `startGame`, after minimum membership and every seat's exact card quota are satisfied. Disconnected seats still count and retain their cards.
- `playCard` needs a card from the acting seat's hand on its turn. `say` posts room chat.
- Every `state.snapshot` is individualized. `myCards` is populated only during authoring; `hand` is populated after dealing. Never use a snapshot from another seat.
- `imageUrl` is relative to the **game server origin**, not the Next.js origin. Resolve it against the HTTP game-server origin or proxy `/rooms/` to this server. Each URL carries only the recipient's token. Do not log these query strings or send them to analytics.
- `agentPending` marks a revealed, in-flight play. The play and interpretation appear in `thread`. Failed interpretations have an explicit failure narration plus `engineError`; do not render them as successful effects.
- `ended` with a non-null `winnerId` is a win. `ended` with null `winnerId` means no playable hands remain.

Images are accessible only to authenticated room members who own the authoring draft,
hold the card in their hand, or can see it as a revealed play. Authorship alone does
not authorize a card after dealing. Missing cards and unauthorized requests both return
404. HTTP responses disable caching and include a no-referrer policy.

## Engine And Agent

`game/engine.mjs` is the read-only seed, exporting the shared `Engine` named exports.
Every room owns a separate source string, rules, deck, scores, thread, and history;
accepted patches never overwrite the seed or another room's engine.

The base engine supports `score` (amount, optional player-id target), `draw` (nonnegative
integer amount, optional target), `reverse`, and `skip` (nonnegative integer amount,
default one). Unknown effects throw. It implements turn quotas, draw-after-play,
rotation around players with empty hands, and first-player-in-seat-order score ties.

`MockAgent` can accept a scripted interpretation function for tests. Its default
heuristic recognizes signed `N points` / `N score`, `draw N`, `reverse`, `skip`, and
`target score N`. Otherwise it grants 10 points. It reads the submitted text, not
image semantics. AgentInput still includes the exact composited PNG for M4 adapters.

The pipeline validates `AgentVerdictSchema`, shallow-merges and validates rules,
then loads and exercises candidate exports in a fresh child. Engine output is checked
for JSON shape, finite scores, unchanged seat identities, card conservation, legal
turn/winner IDs, and consumption of the played card. Rejected candidates never change
the active source, rules, or scores. Retries use `maxRollbackRetries` and `previousError`.
Agent calls and engine runs each have a configured timeout.

On exhausted retries, the server retains last-good source and rules, discards the
card without immediate effects or score changes, draws replacements according to
the retained draw-after-play setting, and advances to the next nonempty hand in the
retained direction. This is an explicit **mechanical failure policy**, not successful
execution of the candidate or last-good engine. The failure is posted to the thread.
All accepted source/rule proposals are retained in persisted verdict entries; source
patches are omitted from browser snapshots.

## Persistence And Limits

Each room's complete server-owned data is saved to `game/rooms/CODE.json` with a
mode-0600 temporary file and atomic rename. Tokens, composed images, current engine,
rules, thread, history, deck, hands and turn survive restart. Connected status does
not persist. An interrupted interpretation is recovered as the same explicit
failure policy so a pending turn cannot remain stuck indefinitely.

- Execution isolation uses Node's permission model, a 64 MiB JS heap cap, an empty environment, forbidden module imports, a VM context with dynamic code generation disabled, bounded output, VM execution deadlines, and an outer process kill deadline. Engine source **never executes in the server process**.
- A child process, `node:vm`, and Node permissions are **not a secure hostile-code sandbox**. This is a trusted-friends/mock-agent development server. Before enabling adversarial or real generated code on a public VM, use an OS/container sandbox with restricted filesystem, network, syscalls, user identity, and CPU/memory limits.
- Pipeline deadlines abort the OpenCode adapter's HTTP request and issue a separate session abort. Mock/custom agents that ignore the optional server-local cancellation signal can still continue work; their stale results are not accepted.
- OpenCode is opt-in for trusted local development only; see M4 setup below. Do not expose generated engines publicly with this sandbox.
- Persistence is single-process and atomic for process crashes, not power-loss durable: no fsync, database transaction, encryption, retention policy, or room cleanup. Invalid/corrupt room files fail startup loudly. Keep the directory private and backed up.
- No production rate limiting, origin allowlist, room/config resource caps, moderation, host transfer, or token expiry/rotation is implemented. Use TLS and access controls before deployment. Seat tokens are bearer credentials.
  The M5 deployment enables an optional bounded demo protection profile and a protected
  same-origin gateway; see `deploy/README.md`. The generic development entrypoint does
  not enable that profile. This does not make real generated engines public-safe.
- Native PNG decoding is bounded by a 3 MB base64 payload limit and card dimensions checked before decode. Text and art are composited and then thresholded to opaque black/white on the server.

## M4 OpenCode Setup

The server uses `@opencode-ai/sdk` 1.18.18's `/v2/client` export with the 1.18.18
CLI (`opencode --version`). It calls `provider.list`, `session.create`,
`session.prompt`, `session.abort`, and `session.delete`. `GameAgent.interpret(input)`
and shared schemas are unchanged; the server passes an optional `AbortSignal`
locally to adapters that support it.

From the repository root:

```sh
npm run opencode:check -w @cards/server
npm run opencode -w @cards/server
```

The check fetches the authoritative `https://opencode.ai/config.json` schema and
validates `server/opencode.json` with Ajv 2020. The runner starts headless
`opencode serve --hostname 127.0.0.1 --port 4097`. Port 4096 is deliberately avoided
because it may belong to the chat runtime. Do not attach to that runtime.
`CARDS_OPENCODE_PORT` changes the runner port; set the game's `OPENCODE_URL`
to the matching localhost URL. No CORS origins or mDNS are enabled. This API has
no password by default: it is for a private, single-user machine, not a shared
host or reverse-proxied service. Never expose its port publicly.

The runner uses a dedicated empty working directory and independent HOME/XDG
directories under `/tmp/opencode/cards-runtime`. Set `CARDS_OPENCODE_HOME` to a
private durable absolute directory for persistent, independently authenticated
use. It forwards only PATH plus its own isolation variables, not provider keys,
proxy credentials or the chat environment. It does not read, display or copy
existing credential files. Do not copy chat credentials into this profile.
For normal provider authentication, stop the runtime and run:

```sh
npm run opencode -w @cards/server -- auth login --provider anthropic
```

Choose a provider/model you can legitimately access using the documented CLI
login flow (the provider above is an example, not a requirement). Restart the
runtime after login or any configuration change; configuration is not hot-reloaded.
Stop with Ctrl-C, then run the same serve command again. No keys are hardcoded.

Set `game.config.json`'s `agent.provider` to `opencode` and `agent.model` to an
explicit `provider/model` identifier. Leave `mock` enabled until access is verified.
Start/restart the game server with `CARDS_ALLOW_GENERATED_ENGINE=trusted-local`
only in a private trusted-friends development environment. This gate also applies
to persisted OpenCode rooms at startup. Each room's stored configuration selects
its adapter, model and timeout; changing the root config does not change old rooms.
The adapter checks the model catalog, connected provider and image capability
before sending a PNG. Catalog zero pricing and connected status do NOT prove
free access or successful authentication. This chat assistant is `gpt-6.1-sol`,
not Space Bunny; no model identity is inferred from the chat.

```sh
npm run opencode:check -w @cards/server -- --smoke
npm run opencode:check -w @cards/server -- --smoke --model opencode/space-bunny-free
```

Smoke runs use a NEW credential-free profile and ephemeral localhost port, list
only model metadata, and attempt a catalog-zero-cost connected image model. They
never execute a returned engine. Exit 0 means a schema-valid verdict was received;
exit 2 reports an access/vision/provider blocker. A normally authenticated paid
model is not exercised automatically by this smoke script.

The adapter sends the exact composited PNG as an SDK file part (`image/png`, data
URL), plus card text, player names, state, rules, full engine source, history and
`previousError`. Every attempt/retry gets a distinct session, including concurrent
rooms. Sessions have deny-all permissions; the runtime disables tools, external
plugins/skills, sharing, snapshots, LSP and formatters. Responses with tool calls
or mismatched session/model identities are rejected. Abort/delete cleanup is
best-effort with bounded independent deadlines; if the runtime is unavailable,
or a create response is lost, orphan sessions may remain in its private data
directory but are never reused by the game.

This is a **JSON proposal adapter**, not an executable `propose_rules` tool. SDK
prompt requests do not accept arbitrary caller-defined tools; a custom tool would
require an OpenCode plugin or MCP server. Native `json_schema` output also relies
on OpenCode's structured-output tool. To keep all tool execution forbidden, the
adapter uses `format: { type: "text" }`, supplies the verdict JSON Schema in the
prompt, and strictly parses the entire response as JSON. It requires narration,
effects and rulesPatch, allows optional full enginePatch, and rejects markdown,
missing fields and unknown top-level keys. Invalid proposals enter the existing
bounded retry/rollback pipeline, never partially applying rules or effects.

### Verification Observation (2026-10-03)

Authoritative schema validation and CLI config loading both passed. In a fresh
profile with no supplied credentials, the catalog listed OpenCode as connected
and `opencode/space-bunny-free` as image-capable with zero input/output cost.
An actual image prompt to that model returned a schema-valid verdict with one
effect; no returned source was executed. `opencode/fledge-alpha-free` also had
zero-cost/image metadata but returned HTTP 403 in the same kind of smoke test.
These are observations, not guarantees of future free access, visual reasoning
quality, quotas, or availability. Other provider access requires normal human
authentication; no existing credential files were inspected or copied.
