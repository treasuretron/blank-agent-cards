import vm from 'node:vm'

let input = ''
for await (const chunk of process.stdin) input += chunk
try {
  const request = JSON.parse(input)
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
  const module = new vm.SourceTextModule(request.source, { context })
  // The only importable module is the reviewed mechanics library, whose source the
  // host passes in. Nothing is read from disk here.
  const mechanics = request.mechanics ?? {}
  const files = new Map()
  const file = name => {
    if (!files.has(name)) files.set(name, new vm.SourceTextModule(mechanics[name], { context, identifier: `mechanics/${name}` }))
    return files.get(name)
  }
  const index = new vm.SourceTextModule(Object.keys(mechanics).map(name => `export * from 'mechanics/${name}'`).join('\n'), { context, identifier: 'mechanics' })
  await module.link(specifier => {
    if (specifier === 'mechanics') return index
    const name = specifier.match(/^mechanics\/([a-z0-9-]+)$/)?.[1]
    if (name && Object.hasOwn(mechanics, name)) return file(name)
    throw new Error(`Engine imports are forbidden except 'mechanics' (got '${specifier}')`)
  })
  await module.evaluate({ timeout: request.timeout })
  const engine = module.namespace
  if (!Number.isInteger(engine.meta?.version) || engine.meta.version < 1 ||
      ['validatePlay', 'applyPlay', 'checkWin'].some(key => typeof engine[key] !== 'function')) {
    throw new Error('Engine must export meta.version, validatePlay, applyPlay, checkWin')
  }
  // Deserialize inside the context; do not expose host objects or functions to engine code.
  context.payload = JSON.stringify({ state: request.state, play: request.play })
  context.engine = engine
  const script = new vm.Script(`
    const args = JSON.parse(payload);
    const valid = engine.validatePlay(args.state, args.play);
    let result = null;
    if (${request.apply ? 'true' : 'false'} && valid.ok === true) result = engine.applyPlay(args.state, args.play);
    const win = engine.checkWin(result ? result.state : args.state);
    JSON.stringify({ version: engine.meta.version, valid, result, win });
  `)
  const output = script.runInContext(context, { timeout: request.timeout })
  process.stdout.write(output)
} catch (error) {
  process.stderr.write(String(error))
  process.exitCode = 1
}
