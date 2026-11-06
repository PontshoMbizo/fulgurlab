# Contributing

## Setup

```bash
sudo apt install --no-install-recommends scilab-cli scilab-full-bin
npm --prefix web install
npm run dev:server    # :8080
npm run dev:web       # :5173
npm test              # needs Scilab for the simulation tests
```

## Adding a block

1. **Catalogue:** add an entry to `shared/catalog.js` (type, label, category,
   params with kinds and defaults, and input/output counts).
2. **Validation:** if the block has rules beyond parameter kinds (positive sample
   time, ordering, properness), add them in `server/src/netlist.js` next to the
   others.
3. **Lowering:** add a `case` in `lower()` in `server/src/codegen.js`. Prefer
   setting the Xcos block's `exprs` (its dialog values) and let `do_eval` build the
   model. Only numbers go through `fmt()`/`polyExpr()`; never put a user string in
   the script. Discrete blocks get `{ clock: ts }`; blocks with a variable input
   count need `{ nin: n }`.
4. **Glyph:** draw it in `web/src/editor/BlockGlyph.tsx`, and give it a footprint
   in `blockSize()` in `web/src/editor/model.ts` if it isn't a plain box.
5. **Test:** add an analytic check to `server/test/simulate.test.js`
   (`chain(source, block)` makes this one line).
6. **Docs:** add a row to `docs/blocks.md`.

To see the generated script for a run, start the server with `SIM_KEEP_WORK=1`
and look in `$TMPDIR/fulgur-*/model.sce`.

## Commits

Small, focused commits whose message says what changed and why.
