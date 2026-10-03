# M0 Contracts

Import public types and schemas from `@cards/shared`. These files are the authoritative implementation contracts; they refine the illustrative interfaces in `PLAN.md`.

## Integration

- Read `game.config.json` and validate with `GameConfigSchema`. After merging room overrides, validate the full configuration again. Initial hands cannot exceed cards contributed per player.
- Validate websocket messages with `ClientMsgSchema`. Room codes are four uppercase letters; clients normalize user input before sending. Names are trimmed.
- Validate submitted cards again with `cardDraftSchema(room.config.card)`. `CardDraftSchema` only checks the transport shape. The server must decode PNGs, enforce image size limits, and composite text; a data URL prefix is not image validation.
- `Card` is server/agent data with a composited PNG. `CardFace` omits the PNG. `CardView` sends a protected image URL to browsers.
- The host sends `startGame` after quotas and minimum player count are met. There is no `readyUp`. Joining is allowed during `authoring`; dealing is an atomic transition into `play`. The final phase is `ended`.
- Broadcast individualized `state` snapshots. `agentPending` replaces separate thinking events; verdicts live in `thread`.
- Send `joined` and its seat token only to the joining socket. `resume` authenticates a reconnect. Never include other players' hand IDs or seat tokens in a snapshot. During play, `myCards` must not reveal unplayed authored cards now held by someone else.
- Image endpoints must authorize the recipient: own drafts during authoring, own hand during play, and publicly played cards. Knowing a card ID or URL is not authorization.

## Engine And Agent

`Engine` in `state.ts` describes named exports: `meta`, `validatePlay`, `applyPlay`, and `checkWin`. A play includes the acting player, card face, and immediate `effects`. Engine calls are synchronous and exchange plain JSON; isolation and result validation belong to M1.

`GameAgent.interpret` receives `AgentInput` and returns an `AgentVerdict`. Validate the verdict with `AgentVerdictSchema`. `enginePatch` is the full replacement source, not a textual diff. Shallow-merge `rulesPatch`, then validate the resulting rules. Effects are extensible records interpreted by the engine; unknown kinds require engine support, not silent application by the server.

Known rule fields remain schema-valid even when cards change their meanings via engine code. `notes` records natural-language rules; additional keys support invented mechanics. `drawAfterPlay: 1` is a provisional initial dealing policy, not an additional immutable base rule.

`previousError` supplies validation failure details on retry. M1 must specify the failure outcome explicitly: retaining the last-good engine is not equivalent to successfully applying the card's effect.

## Verification

From the repository root:

```sh
npm install --workspace @cards/shared --include-workspace-root
npm run typecheck -w @cards/shared
npm test -w @cards/shared
```

Tests use Node 24's TypeScript stripping. Next.js consumers should add `@cards/shared` to `transpilePackages`; Node server consumers should use `tsx`.
