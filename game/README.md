# Room Engines

`engine.mjs` is the base engine seed, not a mutable multiroom singleton. The server
reads its source but never imports it. Each room persists its own rules, active
engine source, game state, cards, tokens, and interpretation audit thread under
`rooms/CODE.json`. The runtime directory is ignored by git.

See `../server/README.md` for engine isolation, rollback, failure outcomes,
persistence limitations, and integration endpoints.
