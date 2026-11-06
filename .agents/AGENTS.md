# fulgurlab: notes for coding agents

fulgurlab is a basic Simulink-style block diagram simulator for scope.io. The
browser editor (`web/`) sends a JSON netlist to a Node server (`server/`), which
generates a Scilab script and simulates it with headless Scilab/Xcos. There is
no simulation engine in the browser. (Until Nov 2026 this repo was a CircuitJS
circuit-simulator fork; that code lives only in git history now, e.g. branch
`cosim-editor`.)

## Ground rules
- Scilab evaluates block parameters as code. Never write a user-supplied string
  into the generated script: numbers go through `fmt()`/`polyExpr()` in
  `server/src/codegen.js`, and ids/names never appear. A test enforces this.
- Every new block needs: a catalogue entry (`shared/catalog.js`), a lowering in
  `codegen.js`, a glyph (`web/src/editor/BlockGlyph.tsx`), an analytic test in
  `server/test/simulate.test.js`, and a row in `docs/blocks.md`.
- Run `npm test` (needs `scilab-full-bin`) and `npm run typecheck` before
  committing.

## Scilab gotchas (2024.0)
- Spawn `scilab-cli` with stdin closed or it never exits.
- Install both `scilab-cli` (the launcher) and `scilab-full-bin` (Xcos simulation library); neither works alone.
- The launcher also needs `dpkg-architecture`; the image provides a stand-in
  (`docker/dpkg-architecture`) instead of installing dpkg-dev.
- Xcos reports errors through `messagebox`; the generated script shadows it.
- After a crash Scilab may hang: keep the hard timeout + process-group kill.
- Don't use `.xcos` files as an interchange format (saving script-built
  diagrams segfaults); the netlist JSON is the format.
- To debug a run: `SIM_KEEP_WORK=1`, then read `$TMPDIR/fulgur-*/model.sce`.

## scope.io integration
scope.io embeds the editor in an iframe (`/?embed=1`, postMessage API) or uses
`POST /api/simulate` directly; see `docs/embedding.md`. The old CircuitJS iframe
integration (`components/Simulator.jsx` in scope.io) targets the previous engine
and must be migrated before this branch replaces what scope.io loads.

If you learn something that would have saved you time, add it here.
