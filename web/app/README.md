# `web/app` — fulgurlab canvas

The Next.js front end: the schematic canvas, palette, inspector, scope, and the
co-simulation drawer. All simulation lives in `@fulgurlab/engine`
(`../engine`) — this package renders it and owns the editing model.

```bash
npm --prefix ../.. install   # install both workspaces from the repo root

npm run dev         # dev server at http://localhost:3000 (turbopack)
npm run test        # vitest, environment: node
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # production build
```

Static export (no server requirement — `/` prerenders as static content):

```bash
NEXT_OUTPUT_EXPORT=1 npm run build   # emits ./out
```

## Layout

| Path | What it is |
|---|---|
| `src/canvas/` | the canvas: interaction model, symbol rendering, hit-testing and marquee geometry (`draw.ts`) |
| `src/engine/store.ts` | the single engine instance, held outside React state; owns undo/redo, import/export, selection, scope channels. Components subscribe with `useSyncExternalStore` against `version` |
| `src/palette/` | placeable-element catalogue, at parity with the Java draw menu (134 entries); `palette.ts` is the single source of truth and is checked against it by `palette.test.ts` |
| `src/inspector/` | the double-click edit dialog; `schema.ts` maps a dump id to its editable fields |
| `src/scope/` | oscilloscope rendering, timebase, and docked/floating persistence |
| `src/extchip/` | lockstep co-simulation client (`client.ts`) and its UI drawer — see [`docs/bridge-protocol.md`](../../docs/bridge-protocol.md) |
| `src/kicad/` | `.kicad_sym` import, symbol previews, element bindings |
| `src/chrome/` | floating toolbar, palette flyout, status cluster |
| `test-utils/` | dependency-free WebSocket server (`miniws.mjs`) and the recorded-transcript fake backend (`fakeBackend.mjs`) |

## Notes

- `environment: "node"` in `vitest.config.ts` is deliberate: everything under test is
  pure logic. React components are not unit-tested; the geometry, store, schema and
  protocol code they depend on is.
- `vitest.config.ts` re-declares the `@/…` path alias, because Vite does not read
  `tsconfig.json`'s `paths`.
- The bridge integration suite (`src/extchip/bridge.integration.test.ts`) replays
  recorded backend transcripts over a real WebSocket, so it runs everywhere. The live
  cross-repo chain lives in `../../integration-tests/`.
