# Room Engines

`engine.mjs` is the base engine seed, not a mutable multiroom singleton. The server
reads its source but never imports it. Each room persists its own rules, active
engine source, game state, cards, tokens, and interpretation audit thread under
`rooms/CODE.json`. The runtime directory is ignored by git.

See `../server/README.md` for engine isolation, rollback, failure outcomes,
persistence limitations, and integration endpoints.

## Mechanics library

`mechanics/*.mjs` holds reviewed snippets that engines can import:
`import { stealPoints } from 'mechanics'` (or `from 'mechanics/points'`). The engine
worker serves these sources itself; every other import is still rejected. Each
exported function needs a `// name(args) → result: what it does` line right above
it. That line is the catalog the agent sees, and the server won't start without it.
Names must be unique across files, and snippets can't import anything.

Saved rooms keep engines that import these names, so the library is append-only:
add functions, but don't rename, remove, or change what an existing one does.
