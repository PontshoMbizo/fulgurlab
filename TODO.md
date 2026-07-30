# TODO — status

The audit that produced this list ran on **2026-07-29** against fulgurlab at
`ff1d49b0`, comparing it with the backed-up circuitjs1 snapshot. Everything on it
has now been worked through (**2026-07-30**), alongside the removal of the Java/GWT
engine — fulgurlab is 100% TypeScript/JavaScript.

## Where things stand

| Suite | Result |
|---|---|
| `web/engine` (vitest) | **198 passed / 15 files** |
| `web/app` (vitest) | **135 passed / 8 files** |
| Bridge integration | **10 passed, 0 skipped** (replays recorded transcripts) |
| `tsc --noEmit`, both workspaces | clean |
| `next build` (full: compile + static generation) | **succeeds**, `/` prerenders as `○ (Static)` |
| `NEXT_OUTPUT_EXPORT=1 next build` | **succeeds**, emits `web/app/out` |
| Java-corpus sweep (`tests/` + `auto-tests/`) | **37/37 clean, 0 unsupported dump ids** |
| Golden traces vs the recorded Java oracle | **12/12 fixtures, 26 probes, 7,300 values, worst case 0.000% of the tolerance budget** |

---

# Resolved

## [x] P0-1. Dump type `164` was mapped to the wrong element

`164` is `CounterElm`, not `ClockElm`. `ClockElm` has no dump id of its own
(`getDumpClass()` → `RailElm`), so it is a palette preset that serializes as `'R'`
with `RailElm.FLAG_CLOCK` — the same arrangement as ACRail/SquareRail/Noise.

Fixed, and the knock-on effects with it: this was indeed the cause of both
`Singular matrix!` results in the corpus sweep (`tests/7seg.txt`,
`tests/custom.txt`), and the same mix-up had also put *clock* fields under `"164"`
in the inspector schema, so editing a counter showed five boxes writing properties
`CounterElm` does not have.

`web/engine/test/dump-id-coverage.test.ts` now guards the whole id table, and
`counter-ripple` is a golden fixture, so the element's real multi-post behaviour is
pinned against the oracle.

## [x] P0-2. `makeSite` never copied `fulgur-bridge.js`

Moot: there is no Gradle build any more. See "Java removal" below.

## [x] P0-3. `reset` / `reset_done` specified but implemented nowhere

Answered by recording a real session against the fpgasim bridge, which replies:

```json
{"type":"error","stage":"proto","log":"reset not supported in v1 — dispose and create"}
```

So `docs/bridge-protocol.md` now marks both messages **reserved, not in v1**, states
that restarting means `dispose` + `create`, and quotes that rejection. The client
implements the full round trip anyway (`ExtChipRegistry.reset()` + the `reset_done`
handler) so it is ready if a backend grows the feature.

Chasing the degradation path found a genuine spec violation: the protocol says a
failure is *"session dead unless `stage:'proto'`"*, but the client's `error` handler
killed the session for every stage — so a backend complaining about an unsupported
message threw away a live session and wedged the chip in `error`. Fixed.

## [x] P1-1. 71 of 126 Java element types had no TS implementation

All ported. Every Java dump id now has a TypeScript implementation, enforced by
`web/engine/test/dump-id-coverage.test.ts` (123 ids). New modules: `chip.ts` (a real
port of the abstract `ChipElm` base), `sequential.ts`, `combinational.ts`,
`memory.ts`, `analog_chips.ts`, `passive.ts`, `meters.ts`, `semiconductors.ts`,
`transformer.ts`, `relays.ts`, `composite.ts`.

`410 CustomComposite` — called out as the highest-leverage single item — is done via
a real `CompositeElm` port, which also brought `400 Darlington`, `407 Optocoupler`,
`409 OpAmpReal`, `417 Unijunction` and `412 Crystal` with it.

Three engine-level bugs fell out of the work:

- The analyzer's child-element expansion overwrote the **authored** element list, so
  a subcircuit's children were re-emitted as top-level dump lines: saving a circuit
  containing an op-amp macromodel produced a file that reloaded as the macromodel
  *plus* 15 stray components at (0,0). Java keeps `app.elmList` (authored) separate
  from `SimulationManager.elmList` (expanded); the engine now does too
  (`simElmList`).
- `stampVCCurrentSource` was inlined in `VCCSElm`; it is a real Stamper primitive
  now (the transformer family and the induction motor need it).
- The parser did not route `.` subcircuit-model lines to the model registry, and
  read `38` adjustable/slider lines as if they were elements.

## [x] P1-2. Palette exposed 61 entries vs the Java draw menu's 141

Now 134 — every placeable entry in `Menus.java`'s `composeMainMenu()`, in Java's nine
categories, in Java's order, with Java's labels. Entries sharing a dump id are Java's
own `getDumpClass()` presets, expressed as flags/tokens. `EXCLUDED_FROM_PALETTE`
documents the 15 menu entries deliberately not offered and why (no dump type, mouse
mode, or legacy alias); `palette.test.ts` pins the two lists together and requires
every entry to construct through the engine factory with its declared tokens.

## [x] P1-3. Whole app subsystems had zero tests

135 app tests, up from 32: `engine/store.ts` (39), `canvas/draw.ts` (17),
`inspector/schema.ts` (11), `scope/scopeUi.ts` (14), `palette` (12), plus the bridge
suites. Writing them found four real bugs:

- **store**: `begin`/`endTransaction` was re-entrancy-guarded on `begin` only, so the
  first inner mutation committed the outer gesture's snapshot and every later one
  became its own undo entry. Any gesture bracketing a mutator that transacts
  internally took several undos to unwind instead of one. Depth-counted now.
- **canvas**: `elementBounds()` assumed posts 0/1 *are* the body endpoints and only
  added posts from index 2 up. A MOSFET's source sits 16 px off `point2`, so it fell
  outside the computed bounds and marquee selection judged the element by a box that
  did not contain all of it.
- **inspector**: the `"164"` schema entry held clock fields (see P0-1).
- **inspector**: the diode and op-amp had no editable fields at all.

## [x] P1-3b. `next build` only verified in `compile` mode

Verified in full (compile + static generation): 5/5 static pages, 185 kB first-load
JS, and `/` prerenders as `○ (Static)`.

## [x] P1-4. Golden-trace gate was thin

Was 5 fixtures × 200 samples × 1 probe = 1,000 values, all linear or mildly
nonlinear. Now 12 fixtures / 26 probes / **7,300 values**, every one matching the
oracle exactly. New fixtures cover precisely the gaps named: op-amp (all three
posts), MOSFET region transitions, a D flip-flop (sequential digital), the 164
counter's four Q outputs, a switching NAND (combinational digital), a three-node RC
ladder (multi-node), and a Schmitt relaxation oscillator (stiff → the
adaptive-timestep path).

The recorder was rewritten and gained an `elm:<i>:<post>` probe form (no coordinate
arithmetic needed to author a fixture) and two guards that each caught a real
mistake before anything was committed: a trace that reads 0 at every sample fails as
a probable misplaced probe (three of the new fixtures had genuinely floating gate
inputs), and the run must end at exactly `(warmup + steps) × dt` (splitting the
"stop and measure" and "step and sample" phases across two `page.evaluate()` calls
let animation frames slip in and silently advanced the oracle ~15 steps).

## [x] P1-5. Integration tests never actually ran

All three skipped without live backends. There is now a recorded-transcript fake
backend (`web/app/test-utils/fakeBackend.mjs`) that replays real backend frames over
a real WebSocket, and `integration-tests/record-transcript.mjs` to capture them.
`transcripts/fpgasim-divider.json` is a genuine recording (real fpgasim bridge +
iverilog/vvp); the rest are spec-derived and each says so in its own `note` field,
which a test asserts is present.

`web/app/src/extchip/bridge.integration.test.ts` — 10 cases, never skipped — covers
handshake, session creation, pin adoption, quantum pacing, the one-step-in-flight
rule, the skew guard's pause/resume balance, reset against both a supporting and a
rejecting backend, `ended`, and a compile-stage error. The live cross-repo chain
remains in `integration-tests/`, skipping only when a toolchain is absent.

## [x] P2-1. `web/engine` failed `tsc --noEmit`

Fixed; both workspaces are clean, and `npm run typecheck` runs them together.

## [x] P2-2. 3,330 `node_modules` files committed under `tools/golden-recorder/`

Untracked and ignored, as the item asked. **Note:** this stops further growth but
`.git` stays at ~113 MB, because history still holds the blobs. Shrinking that needs
a history rewrite (`git filter-repo`), which changes every commit SHA — deliberately
not done here; it is a call for the repo owner to make, ideally right after a push
so the remote and any clones can be re-pointed in one go.

## [x] P2-3. Unpushed commits on `master`

See "Remaining" below — the work is committed; pushing is the one step left.

## [x] P2-4. Stale branch `master.lock.stale-2026-07-14`

Verified fully merged into `master` (`git merge-base --is-ancestor` → yes, zero
unique commits), then deleted.

## [x] P2-5. `web/engine/dist/` was stale

Deleted. It is gitignored, so nothing is lost, and nothing imports from it.

## [x] P2-6. `web/app/README.md` was `create-next-app` boilerplate

Rewritten: scripts, a per-directory layout table, and the notes that actually matter
(why `environment: "node"`, why the `@/` alias is re-declared for Vite, where the
bridge tests live).

---

# Java removal (100% TS/JS)

The Java/GWT engine, its Gradle build, the GWT host page, the Electron wrapper, the
i18n tooling and the WebSocket demo are all gone; so are the 766 committed `.class`
files. The repository is TypeScript/JavaScript only.

Parity with the original is still enforced without any Java: the golden-trace gate
replays traces recorded from the real GWT build, and
`tools/golden-recorder/record.mjs --site <dir>` can be pointed at any externally
compiled circuitjs1 site to re-record or extend them.

CI dropped JDK 8 and Gradle. `build.yml` runs typecheck, both test suites, lint and a
production build; `deploy-pages.yml` publishes the Next app, using the opt-in
`NEXT_OUTPUT_EXPORT=1` static export so GitHub Pages needs no server.

**One local leftover, deliberately not deleted:** `site/` (~97 MB) is the compiled
GWT oracle from before the removal. It is gitignored and nothing in the repo depends
on it, but it is what `record.mjs --site ../../site` was pointed at to record the
current fixtures. Delete it whenever you like; re-recording later just needs any
compiled circuitjs1 build.

---

# Remaining

- **Push.** `master` is ~34 commits ahead of `origin/master` and has never been
  pushed. The backup snapshot is still the only redundancy.
- **`.git` size.** ~113 MB from the historical `node_modules` blobs (see P2-2). Needs
  a history rewrite if it matters; owner's call.
- **Dump format vs Java.** Still deliberately not byte-compatible
  (`docs/react-rewrite-plan.md`, audit item 5). Now that Java is gone this only
  matters for a scope.io migration that wants old files readable by both — worth
  settling before that lands. Reading Java-written files works today (37/37 corpus
  files parse, analyze and round-trip); it is *writing* files a Java build could
  reload that is not guaranteed.
- **Subcircuit model library.** `410 CustomComposite` works, but Java shipped two
  built-in stored models (`~LM317-v2`, `~TL431`) from browser local storage. This
  port has no model library, so the palette offers only the generic Subcircuit
  Instance; a `.` model line must be loaded first.
- **Tri-state `CustomLogicElm` models.** Still refused at construction rather than
  simulated wrong (documented in `custom_logic.ts`); no corpus fixture needs it.
