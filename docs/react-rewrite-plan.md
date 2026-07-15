# fulgurlab React rewrite — execution plan

**For the executing agent (Claude Sonnet 5).** This document is the single source of
truth for rebuilding fulgurlab as ONE tool: a React/TypeScript circuit simulator where
Falstad's component library and the co-simulated FPGA/MCU chips live in the same
palette, on the same canvas, with no GWT and no iframes.

Decided with Pontsho 2026-07-13: **TypeScript engine**, **core ~40 elements before
switchover** (Tier 1, §A.1), old GWT build retained as the *test oracle* until parity
sign-off.

---

## 1. Context — what exists and what is frozen

| Asset | Where | Status |
|---|---|---|
| GWT circuit engine (Java) | `src/com/lushprojects/circuitjs1/client/` | **Oracle.** Never broken/deleted until Phase 8 sign-off. Solver: `SimulationManager.java` (analyzeCircuit :788, stampCircuit :932, stamp API :1128+, runCircuit :1253, lu_factor :1655, lu_solve :1750). 151 `*Elm.java` element classes. Text format I/O: `CircuitLoader.java`, per-element `dump()`/`StringTokenizer` ctors. |
| Prebuilt GWT site | `site/` | Runs with `python3 -m http.server` — no GWT compile needed to use the oracle. |
| Lockstep bridge protocol v1 | `docs/bridge-protocol.md` | **Frozen.** Additive changes only. |
| fpgasim backend (`:3100`) | `../fpgasim` (bridge/server.mjs, lockstepHarness/Session/Codec) | Working, 198 tests + real-vvp e2e green. Do not modify except additively. |
| mcusim backend (`:3101`) | `../mcusim` (bridge/server.mjs, lockstepGlue, semihosting lockstep) | Working, 81 tests + real-QEMU e2e green. Hard-won QEMU gotchas documented in the vault ADR `10 - Projects/fulgurlab/decisions/2026-07-13 lockstep bridge architecture.md` — read it before touching anything QEMU-adjacent. |
| Browser bridge client | `war/fulgur-bridge.js` + `jstests/` (incl. dependency-free `miniws.mjs` ws server) | Port to TS in Phase 4; transliterate its 6 unit tests. |
| Cross-repo integration tests | `integration-tests/bridge.integration.test.mjs` | Pattern to copy for the new engine's ExtChip integration tests. |
| Test circuits corpus | `tests/*.txt` (30 files), `auto-tests/*.txt` (7 files) | Seed corpus for golden fixtures and import-compat tests. |
| Java ExtChipElm | `client/ExtChipElm.java` (dump type 460) | Reference semantics for the TS ExtChip; retired with the GWT build. |

**Non-goals (v1):** full 151-element parity (Tier 2/3 come after switchover); circuit
sharing links/LZ compression; localization; mobile UI; multi-user sessions; changing
the sandbox/backends.

---

## 2. Ground rules — how to work (read at the start of EVERY session)

1. Follow the workspace core loop (`~/Workspace/CLAUDE.md`): orient → explore before
   editing → smallest correct change → verify → commit small → capture decisions in
   the vault (`second brain/10 - Projects/fulgurlab/`).
2. **The oracle wins.** When the TS engine and the GWT engine disagree on a waveform,
   the GWT engine is right unless you can prove a Java bug (document any such
   exception in `docs/oracle-divergences.md` with circuit + explanation).
3. **One phase per session** (roughly). Re-read §2 and your phase section at session
   start. At session end: all gates green, commits pushed, tick the checklist in §12,
   note surprises in the vault.
4. Port faithfully first, refactor later. Keep Java names in the TS port
   (`stampResistor`, `doStep`, `startIteration`) — mechanical correspondence is what
   makes the port reviewable and debuggable against the Java.
5. Never `npm install` a dependency not listed in §3.4 without recording a decision
   note in the vault.
6. Determinism is sacred in tests: fixed timestep, fixed seeds, no wall-clock time in
   the engine (inject a clock where needed — the bridge client pacing is the only
   consumer).
7. Each element port lands as its own commit: `model + params + registry + fixture +
   golden test + draw`.

---

## 3. Target architecture

### 3.1 One repo, one tool

Everything lives in this repo (`fulgurlab`) under a new `web/` npm workspace. The
gradle/GWT tree stays untouched at the root until retirement.

```
fulgurlab/
├── src/…                      # GWT Java (oracle — untouched)
├── site/                      # prebuilt oracle site (untouched)
├── docs/
│   ├── bridge-protocol.md     # frozen protocol
│   ├── react-rewrite-plan.md  # this file
│   └── oracle-divergences.md  # created in Phase 1
├── tools/
│   └── golden-recorder/       # Phase 0: records oracle traces via puppeteer
├── web/                       # NEW — npm workspaces root
│   ├── package.json           # workspaces: ["engine", "app"]
│   ├── engine/                # @fulgurlab/engine — pure TS, zero DOM imports
│   │   ├── src/
│   │   │   ├── core/          # matrix, nodes, solver, sim loop
│   │   │   ├── elements/      # one folder per element
│   │   │   ├── io/            # Falstad text format parse/serialize
│   │   │   ├── bridge/        # lockstep bridge client (protocol v1)
│   │   │   └── index.ts
│   │   ├── test/              # vitest; golden/ fixtures JSON
│   │   └── package.json
│   └── app/                   # @fulgurlab/app — Next.js 16 + React 19 + Tailwind
│       ├── src/
│       │   ├── canvas/        # renderer + interaction state machine
│       │   ├── palette/       # component library UI
│       │   ├── dialogs/       # schema-driven edit dialogs
│       │   ├── scopes/        # waveform pane
│       │   ├── extchip/       # Monaco drawers, board presets, status UI
│       │   └── app/           # Next app router pages
│       └── package.json
```

### 3.2 Engine/UI seam

- `@fulgurlab/engine` exports a `CircuitEngine` class: imperative, headless, runs in
  node (all solver/element tests run without a browser) and in the browser.
- The React app owns a single engine instance outside React state. React subscribes
  via `useSyncExternalStore(engine.subscribe, engine.getSnapshotVersion)` — the engine
  bumps a version counter per completed frame; canvas drawing reads engine state
  directly in a `requestAnimationFrame` loop (no per-element React nodes — Canvas 2D,
  like Falstad).
- Element **draw code is separate from model code** (`elements/resistor/model.ts` vs
  `draw.ts`) so the engine package never imports DOM types. Draw modules register
  into a renderer-side registry keyed by the same element ids.

### 3.3 The FPGA/MCU seam (unchanged)

The bridge protocol v1 and both backend servers are reused as-is. The TS
`BridgeClient` (port of `war/fulgur-bridge.js`) is the only new bridge code. The
ExtChip element is a normal engine element whose `execute()` exchanges pin bits with
the client — identical semantics to the Java `ExtChipElm` (bounded-skew pacing, pause
via engine stop, per-direction pin-order contract).

### 3.4 Dependencies (complete list — anything else needs a vault decision note)

- `web/engine`: **zero runtime deps.** Dev: `typescript`, `vitest`.
- `web/app`: `next@16`, `react@19`, `react-dom@19`, `tailwindcss@4`,
  `@monaco-editor/react` (same as fpgasim), `@fulgurlab/engine`. Dev: `typescript`,
  `eslint`, `eslint-config-next`, `vitest`, `@vitejs/plugin-react` (component tests).
- `tools/golden-recorder`: `puppeteer` (already a dep in ../fpgasim; hoist a private
  package.json here).
- Node ≥ 22 everywhere (global WebSocket, matches the sibling repos' CI matrix).

---

## 4. Phase plan (the executable spine)

Each phase lists: goal, tasks, and a **gate** (measurable exit criteria). Do not start
phase N+1 with a red gate. Estimated total: 15–20 focused agent sessions.

### Phase 0 — Scaffolding + oracle harness (1–2 sessions)

Goal: `web/` workspace builds; golden traces can be recorded from the GWT build.

Tasks:
1. Create `web/` workspaces (`engine`, `app` — app is a bare Next 16 create for now),
   TS strict configs, vitest wiring, `npm run -w engine test` green with a placeholder
   test. ESLint rule (`no-restricted-imports` of `react`/DOM libs) enforcing engine
   purity.
2. **Oracle stepping API** (the one permitted GWT change): add to
   `JSInterface.java` + `setupJSInterface()`:
   - `stepSim(n)` — with the sim stopped, run exactly n iterations of the
     `runCircuit` path at fixed `timeStep` (locate the per-frame call into
     `SimulationManager.runCircuit(...)` and factor a loop that advances exactly one
     `timeStep` per call, adaptive subdivision disabled via `maxTimeStep == timeStep`).
   - `getNodeVoltageList()` — array of all node voltages, index order = node order.
   - `getElementCurrent(i)` / reuse existing `getJSElements()` handles.
   Verify by pushing (CI compiles GWT) or by local `./gradlew compileGwt` where
   possible; the sandbox may not reach maven — CI is the compile gate then.
3. `tools/golden-recorder/record.mjs`: serve `site/` on localhost, puppeteer:
   `importCircuit(text)` → `setSimRunning(false)` → loop `stepSim(1)` +
   sample probes → write `web/engine/test/golden/<name>.json`:
   ```json
   { "name": "rc-lowpass", "circuit": "<falstad text>", "dt": 5e-6, "steps": 2000,
     "probes": { "nodes": [1,2], "elements": [0] },
     "traces": { "node:1": [ ... ], "elm:0:current": [ ... ] } }
   ```
4. Record fixtures for the Phase 1 element set from hand-written minimal circuits
   (see §A.3 fixture list) plus 5 corpus circuits from `tests/` that use only Tier-1
   elements (`lrc.txt`, `fullrect.txt`, `capac.txt` candidates — inspect first).

Gate: `node tools/golden-recorder/record.mjs --all` produces ≥ 15 fixture JSONs,
deterministic across two runs (byte-identical traces); workspace `npm test` green.

### Phase 1 — Engine core + linear elements (2–3 sessions)

Goal: the MNA solver runs Falstad-text circuits of linear Tier-1 elements and matches
the oracle.

Tasks (port order matters):
1. `core/lu.ts` — port `lu_factor_dense` / `lu_solve` from `SimulationManager.java`
   :1669/:1750 exactly (partial pivoting, singular detection). Property tests: random
   diagonally-dominant systems vs a naive Gaussian solver; singular matrix detection.
   (Skip the `CircuitMatrix` sparse wrapper — dense first; perf work is Phase 8+.)
2. `core/node.ts` — `CircuitNode`, `CircuitNodeLink` (port `CircuitNode.java`),
   node allocation, wire closure (`calculateWireClosure`), ground handling,
   post→node mapping. Port `analyzeCircuit()` (:788) including internal nodes,
   unconnected-node detection and the singular-matrix diagnostics.
3. `core/engine.ts` — `stampCircuit()` (:932) with row simplification
   (`ROW_NORMAL`/`ROW_CONST` machinery — port it, it's what keeps matrices small),
   full stamp API surface used by Tier-1 elements: `stampResistor`, `stampConductance`,
   `stampVoltageSource` (3 overloads), `stampCurrentSource`, `stampRightSide`,
   `stampMatrix`, `stampNonLinear`, `updateVoltageSource`. Then `runCircuit()`
   (:1253): nonlinear iteration loop, convergence flag, iteration cap, timestep state
   (`timeStep`, `maxTimeStep`, `timeStepAccum` — :50–:60), and a **deterministic mode**
   (`engine.stepOnce()` = exactly one `timeStep`, adaptive off) mirroring the oracle's
   `stepSim`.
4. `core/element.ts` — `CircuitElm` base: posts, nodes, voltages, `setNodeVoltage`,
   `getVoltageDiff`, `calculateCurrent`, geometry as pure data (x,y,x2,y2,flags,
   points computed via `setPoints()` — port the math; rendering consumes it later).
   `params` schema replaces `EditInfo` (§8.2).
5. `io/falstadText.ts` — parse/serialize: `$` options line (dt, iterCount, voltage
   range…), element lines (`<dumpId> x y x2 y2 flags <element tokens…>`), the escape
   scheme from `CustomLogicModel.escape/unescape`, `w`/`r`/`g`… short codes and
   numeric dump ids via `registry.ts`. Unknown elements: **preserve verbatim** and
   warn (forward-compat with Tier-2/3 circuits; round-trip must not lose them).
6. Elements (each per §8 playbook): Wire, Ground, Resistor, DCVoltage/ACVoltage
   (VoltageElm variants), Rail/Clock (RailElm waveforms), Switch, Switch2 (SPDT),
   Capacitor, Inductor (companion models — port `startIteration`/`doStep` exactly),
   Current source, Probe/Output, LabeledNode, Text, Box, Ammeter, Potentiometer.

Gate: golden tests green for all linear fixtures at tolerance `rtol 1e-6, atol 1e-9`
(pointwise, every step); `tests/lrc.txt` (and other Tier-1-only corpus circuits)
round-trip byte-stable through parse→serialize (modulo whitespace); engine has zero
DOM imports (lint gate); vitest suite < 30 s.

### Phase 2 — Nonlinear devices (2 sessions)

Goal: diodes and transistors converge like the oracle.

Tasks: port `DiodeElm` (+ the shared `Diode.java` model file: exp limiting /
`limitStep`), `ZenerElm`, `LEDElm`, `TransistorElm` (Ebers-Moll with the same
`limitStep` damping), `MosfetElm`, `OpAmpElm` (ideal, with the saturation clamp);
convergence machinery: `converged` flag, subiteration limit, the
non-convergence → halve-timestep behavior (verify against oracle by recording a
deliberately hard fixture, e.g. full-wave rectifier at large dt); `getInfo`-equivalent
metadata for the UI later.

Gate: nonlinear fixtures (diode clipper, bridge rectifier `fullrect.txt`, BJT
common-emitter amp, MOSFET inverter, op-amp follower + integrator) match oracle at
`rtol 1e-3` pointwise; no fixture needs > oracle's iteration count ×2 to converge.

### Phase 3 — Digital elements + chip pattern (1–2 sessions)

Goal: the ChipElm pattern and Tier-1 logic work; analog/digital boundary matches.

Tasks: port `ChipElm` base (pins, `sizeX/sizeY`, `SIDE_*`, threshold `highVoltage/2`,
voltage-source-per-output stamping, `execute()` hook — this is the base ExtChip needs);
`GateElm` family (AND/OR/XOR/NAND/NOR/Inverter, incl. input count param + the
`highVoltage` flag semantics), `LogicInputElm`, `LogicOutputElm`, `DFlipFlopElm`,
`JKFlipFlopElm`, `SevenSegElm`, `CustomLogicElm` + `CustomLogicModel` (rule-table
format port — needed by scope.io problem sets).

Gate: digital golden fixtures (gate truth-table sweep driven by LogicInputs, DFF
divider, 7-seg counter from corpus `tflipflop.txt`, custom-logic `custom.txt`) match
oracle (`rtol 1e-6` — digital nodes are effectively exact); ChipElm base has unit
tests for pin allocation/threshold/drive identical to Java behavior.

### Phase 4 — Bridge client + ExtChip element (1 session)

Goal: FPGA/MCU chips work in the TS engine, verified against the real backends.

Tasks:
1. `bridge/client.ts` — port `war/fulgur-bridge.js` 1:1 (configure/setInputs/
   getOutputs/onSimTime/status/events/dispose; per-direction `pinsMatch`; pause via
   an injected `SimControl` interface implemented by `CircuitEngine`). Transliterate
   `jstests/fulgur-bridge.test.mjs` + `miniws.mjs` into vitest.
2. `elements/extchip/` — port `ExtChipElm.java` semantics onto the TS ChipElm base
   (dump type 460, same dump token order → old circuits with ExtChips load). Plus one
   improvement the Java couldn't do cleanly: `adoptPins(created.pins)` — after
   `created`, if the declared spec was empty, adopt the backend's pin list and
   re-layout (dump still serializes the canonical spec afterwards).
3. `integration-tests/` (engine-level): copy the pattern from
   `integration-tests/bridge.integration.test.mjs` — spawn real fpgasim/mcusim bridge
   servers from sibling checkouts with host-mode entrypoints, drive
   `engine.stepOnce()` in a loop, assert a Verilog divider and the PC13-mirror
   firmware drive/read engine node voltages through actual R/LED elements. Skip
   gracefully when toolchains/siblings are missing (same `have()` guards).

Gate: bridge client vitest suite green (hermetic); engine integration tests green
with real iverilog + QEMU locally; `quantum pacing` unit test proves the engine
pauses/resumes at one-quantum skew.

### Phase 5 — React app: canvas editor (3–4 sessions)

Goal: usable editor — place, wire, edit, run, save/load — for everything Tier 1.

Tasks:
1. Canvas renderer: DPR-aware single `<canvas>`, pan/zoom (wheel+drag, pinch later),
   grid snap (`gridSize` 16), the draw-helper API (port `CircuitElm.draw*` helpers:
   `drawThickLine`, `drawPosts`, dot current animation, voltage color scale — port
   `setVoltageColor` gradient exactly; current dots use `curcount` port).
   Draw modules for every Tier-1 element (mechanical port of each `draw()`).
2. Interaction state machine (explicit union type, no boolean soup): `select`,
   `drag-elm`, `drag-post`, `drag-new-element`, `marquee`, `pan`, `wire-split`.
   Port behaviors from `MouseHandler`/`UIManager.java` (hit-testing via element
   `getPost`/bounding boxes, shift-constraints, double-click opens edit dialog).
3. Undo/redo: snapshot the dump string on every mutation commit (exactly the Java
   `undoStack` approach — cheap and format-exercising).
4. Palette: categories mirroring `Menus.java` tree (extract the `makeClassCheckItems`
   arrays: Basic / Passive / Inputs & Sources / Outputs & Labels / Active /
   Active Building Blocks / Logic Gates / Digital Chips / Analog & Hybrid, plus a new
   top-level **“Co-simulated chips”** with Tang Nano 9K and STM32 Blue Pill cards).
   Search box over names + keyboard shortcut parity (extract shortcut chars from
   Menus.java before building).
5. Edit dialogs: schema-driven form from element `params` (number w/ unit + slider
   where `allowSliders`, text, select, checkbox, textarea) — one generic
   `<ElementDialog>`, zero per-element dialog components (ExtChip drawer in Phase 6
   is the exception).
6. File: open/save `.txt` (Falstad format), import from clipboard, export selection
   as subcircuit text; localStorage autosave; `examples/` menu loading the repo
   corpus.
7. Simulation chrome: run/stop, speed slider (`iterCount`-equivalent), timestep
   control, reset; status line (converged/singular warnings surfaced like the Java
   `stop()` messages).

Gate: scripted Playwright (or puppeteer, reuse recorder infra) smoke: load
`lrc.txt` from corpus → runs, waveform visibly oscillates (assert via engine node
samples, not pixels); place-wire-edit-undo flow test; all Tier-1 elements placeable
from palette and render without exceptions; `next build` clean; Lighthouse perf not
required but 500-element corpus circuit sustains 30 fps on dev hardware (manual
check, note the number).

### Phase 6 — Scopes + ExtChip UX (1–2 sessions)

Goal: the “one tool” payoff — waveforms and code drawers in the same window.

Tasks:
1. Scope pane: port the essential 20% of `Scope.java` — per-scope ring buffer of
   min/max per pixel column, speed (sim-steps/px), stack of scopes docked bottom,
   add-to-scope from element context menu, voltage+current traces, auto-scale,
   manual scale, RMS/avg/freq readouts (port the calc methods — `simulator.md`
   documents the semantics his fork already exposes via JS API).
2. ExtChip drawer: right-side panel when an ExtChip is selected — Monaco editor
   (verilog / c language modes), board preset dropdown (Tang Nano 9K → fpgasim URL +
   sample blinky Verilog; Blue Pill → mcusim URL + PC13 blinky C with
   `LOCKSTEP_PINS`), engine selector (mainline/xpack) for MCU, quantum control,
   status chip (unconfigured/connecting/compiling/running/ended/error with log
   viewer), Apply = `configure()` round-trip, “Adopt pins from build”.
3. ExtChip event lanes: the bridge `events` stream (`[t_ns, PIN, v]`) renders as
   digital lanes in the scope pane (this is data the GWT tool always dropped —
   intra-quantum edges from vvp/QEMU visible next to analog traces).
4. Wire the app to bridges via `NEXT_PUBLIC_FPGASIM_BRIDGE` / `NEXT_PUBLIC_MCUSIM_BRIDGE`
   (defaults `ws://localhost:3100|3101`).

Gate: manual e2e with real backends: blinky Verilog ExtChip → LED+resistor circuit
blinks on canvas; PC13 firmware drives an LED; a circuit voltage divider feeding
PA0 flips firmware behavior (bidirectional proof — mirror the integration-test
circuits interactively); scope shows analog trace + digital event lane together;
all recorded as a short demo circuit committed to `examples/fulgurlab/`.

### Phase 7 — Import compatibility + Tier-1 hardening (1–2 sessions)

Tasks: corpus sweep — every file in `tests/` and `auto-tests/` must parse without
crashing (Tier-2/3 elements → placeholder “unsupported element” box that preserves
tokens on re-save); triage the ~10 most-used Tier-2 elements in his scope.io problem
set (ask Pontsho for the export, or grep scope.io fixtures) and pull them forward if
cheap; error UX (singular matrix, unconnected nodes) matches Java messages; a11y+
keyboard pass on dialogs/palette.

Gate: 100% of corpus parses & round-trips losslessly; scope.io priority elements
list agreed with Pontsho and either ported or scheduled; zero console errors across
the examples gallery.

### Phase 8 — Parity sign-off, embed API, deploy, retirement (1–2 sessions)

Tasks:
1. `window.CircuitJS1`-compatible shim on the app (importCircuit, setSimRunning,
   getTime, getNodeVoltage, the scope getters from `simulator.md`) so **scope.io
   swaps an iframe URL and nothing else**; verify against
   `scope.io/components/Simulator.jsx` usage (`?startCircuit=…&hideMenu=true` query
   params honored).
2. Deploy: static-export the app (or compose service like the siblings — decide with
   Pontsho based on VPS setup) + envs for bridge URLs; extend `.github/workflows/`
   with `web` job (typecheck, vitest, build, engine-purity lint). Keep the GWT build
   job until this phase signs off.
3. Retirement decision with Pontsho: archive the GWT tree (`git tag gwt-final`),
   update `README.md`, workspace `CLAUDE.md`, vault dashboard; oracle recorder and
   fixtures stay (they now guard the TS engine against regressions).

Gate: Pontsho approves side-by-side; scope.io staging works against the new embed;
CI green including golden + integration suites.

---

## 5. Engine port spec (detail for Phases 1–3)

### 5.1 Source-of-truth map (Java → TS)

| Java (client/) | TS (web/engine/src/) | Notes |
|---|---|---|
| `SimulationManager.java` :1655–:1810 | `core/lu.ts` | Port `lu_factor_dense` + `lu_solve`. Ignore `CircuitMatrix` sparse path for now (add a `// PERF: CircuitMatrix port` marker). |
| `SimulationManager.java` :788 `analyzeCircuit` | `core/analyze.ts` | Wire closure, node map, internal nodes, voltage-source numbering, connectivity validation. |
| `SimulationManager.java` :932 `stampCircuit` + row-simplification | `core/engine.ts` | Keep `RowInfo` port including `ROW_CONST` elimination — it is required for matching oracle matrices. |
| `SimulationManager.java` :1253 `runCircuit` | `core/engine.ts#stepFrame/stepOnce` | Deterministic `stepOnce()` used by golden tests; frame loop used by the app. |
| `CircuitElm.java` | `core/element.ts` | Geometry, posts, node voltage plumbing, current, dump plumbing. |
| `CircuitNode.java` | `core/node.ts` | 1:1. |
| `CircuitLoader.java` + per-elm `dump()` | `io/falstadText.ts` + per-element `serialize/parse` | `$` options line first; keep the exact token order per element. |
| `ChipElm.java` | `elements/_chip/chipBase.ts` | Base for gates-with-pins, FF, ExtChip. |
| Individual `XxxElm.java` | `elements/xxx/model.ts` | See §8 playbook. |
| `war/fulgur-bridge.js` | `bridge/client.ts` | 1:1 port; `_simCtl` becomes constructor-injected `SimControl`. |
| `Menus.java` shortcut/category arrays | `app/src/palette/catalog.ts` | Extracted data, not logic. |
| `Scope.java` (subset) | `app/src/scopes/` | Ring buffers + readouts only in v1. |

### 5.2 Type conventions

- Matrix: `number[][]` rows (dense), `Int32Array` for `ipvt`; right side `Float64Array`.
- Java `int` flags → `number` + `const` flag objects (`FLAGS = { CUSTOM_VOLTAGE: 1 << 13 }`).
- `StringTokenizer` → `Tokenizer` util (whitespace split, `nextInt()/nextDouble()/next()`,
  plus `escape/unescape` ported byte-for-byte from `CustomLogicModel.java` :257).
- `EditInfo` → `ParamSpec`:
  ```ts
  type ParamSpec =
    | { kind: "number"; key: string; label: string; unit?: string;
        min?: number; max?: number; allowSlider?: boolean }
    | { kind: "select"; key: string; label: string; options: string[] }
    | { kind: "checkbox" | "text" | "textarea"; key: string; label: string };
  ```
- No exceptions for control flow in the solver; convergence/singularity are returned
  statuses surfaced as engine events (`engine.on("stopped", reason)`).

### 5.3 Element base contract (must match Java semantics exactly)

```ts
abstract class CircuitElm {
  x = 0; y = 0; x2 = 0; y2 = 0; flags = 0;
  nodes: number[] = []; volts: number[] = [];
  abstract getDumpType(): number | string;      // same ids as Java (§A.1 table)
  getPostCount(): number { return 2; }
  getVoltageSourceCount(): number { return 0; }
  getInternalNodeCount(): number { return 0; }
  nonLinear(): boolean { return false; }
  setPoints(): void { /* port geometry */ }
  stamp(e: Stamper): void {}
  startIteration(): void {}                     // companion-model updates (C, L)
  doStep(e: Stamper): void {}                   // per Newton subiteration
  stepFinished(): void {}
  reset(): void {}
  calculateCurrent(): void {}
  serialize(tk: TokenWriter): void {}           // token order == Java dump()
  // params(): ParamSpec[]; getParam/setParam by key
}
```

The `Stamper` interface is the stamp API subset of `core/engine.ts` — elements never
see the matrix directly (same discipline as Java, where `sim.stampX` is the seam).

### 5.4 Known Java behaviors that MUST be preserved (easy to miss)

- Voltage color gradient and current-dot spacing are cosmetic — but `curcount`
  update math lives in `CircuitElm.updateDotCount` and golden tests don't cover it;
  port it anyway for visual parity.
- `RailElm`/`VoltageElm` waveform phase conventions (`freqTimeZero` handling) —
  golden tests will catch, but read the Java comments first.
- Capacitor/inductor companion models change stamps between `stamp()` (constant part)
  and `doStep()` (per-iteration) — the split matters for the `ROW_CONST`
  simplification. Port `stamp/startIteration/doStep` as a unit.
- Switch `getShortcut`/flags encode momentary vs toggle; SPDT `Switch2Elm` dump
  format differs — check `tests/` corpus files that use them.
- `OpAmpElm` output clamping uses `lastvd` damping — port it or converge failures
  appear on the integrator fixture.
- Ground is node 0 everywhere; `stampVoltageSource(ground, n, vs)` overloads with
  implicit ground — match the overload semantics with explicit `GROUND = -1`?
  **No** — keep the Java convention exactly (nodes array, ground = node index 0)
  to keep the port mechanical.

---

## 6. Oracle & golden harness spec (Phase 0 detail)

### 6.1 `stepSim` patch sketch (JSInterface.java)

```java
void stepSim(int n) {
    // deterministic: adaptive off, exactly n * timeStep of sim time
    app.setSimRunning(false);
    for (int i = 0; i < n; i++)
        app.simulationManager.stepDeterministic(); // add: one timeStep, no repaint
}
```
plus `getNodeVoltageList()` returning `JsArrayNumber`. Add
`stepDeterministic()` next to `runCircuit` (:1253) — it is the same body with the
frame-time budget and adaptive subdivision removed. Keep the patch ≤ ~60 lines,
commit separately (`oracle: deterministic stepping API`), let CI compile it.

### 6.2 Recorder protocol

- Fixture inputs live in `tools/golden-recorder/fixtures/*.circuit.txt` with a
  header comment naming probes: `#probe node:LABEL elm:INDEX:current`. Use
  `LabeledNodeElm` labels, not raw node indices, wherever possible (node numbering
  must match between engines only via labels).
- Recorder resolves labels through the JS API (`getLabeledNodeVoltages` exists
  already), records `steps × probes` Float64 arrays, writes JSON (arrays plain, not
  base64 — diffs stay reviewable).
- Comparator (`web/engine/test/golden.util.ts`): pointwise
  `|a-b| <= atol + rtol*max(|a|,|b|)`; per-fixture tolerance overrides in the JSON.
  On failure print: first divergent step, both values, and an ASCII sparkline of
  both traces around it (debuggability is the point — invest here).

### 6.3 Determinism rules

Oracle and TS engine both run: fixed `dt` from the `$` line, adaptive subdivision
off, same iteration caps, `Math.exp` etc. are IEEE-identical across JVM/GWT-JS and
V8 for the operations used — if a divergence traces to transcendental rounding,
document it in `oracle-divergences.md` and raise that fixture's tolerance, never
"fix" it by tweaking engine math.

---

## 7. Falstad text format (Phase 1 detail)

- Options line: `$ <flags> <maxTimeStep> <iterCount-ish speed> <currentSpeed>
  <voltageRange> <powerRange> <minTimeStep?>` — port the exact reader from
  `CircuitLoader.java` (verify field meanings there; do not guess).
- Element line: `<type> <x> <y> <x2> <y2> <flags> <tokens…>` where `<type>` is a
  dump id (int) or letter (`w`,`r`,`g`,`s`,`c`,`l`,`v`,`t`,…). The registry table in
  §A.1 lists both forms per element (extract letters from each Java `getDumpType()`).
- Unknown element policy: wrap tokens in `UnknownElm` (renders a labeled grey box,
  posts at x/y–x2/y2, does not stamp; serializes verbatim). This keeps Tier-2/3
  circuits loadable and non-destructive from day one.
- Scope lines (`o …`), hint lines (`h …`), adjustable sliders (`38 …` / `&` params):
  parse and preserve; wire scopes up in Phase 6, sliders in Phase 7.

---

## 8. Element porting playbook (repeat per element)

### 8.1 Checklist (one commit per element)

1. Read the Java file top to bottom. Note ctor token order, flags, edge cases.
2. `elements/<name>/model.ts` — port fields, `setPoints`, stamps, steps, serialize.
3. `elements/<name>/params.ts` — `ParamSpec[]` from `getEditInfo/setEditValue`.
4. Register in `elements/registry.ts` (dump id + letter + display name + category +
   shortcut). The registry test asserts: ids unique, every Tier-1 corpus file's
   element set resolvable.
5. Fixture: minimal circuit exercising its physics (§A.3 has the list) → record via
   oracle → golden test green.
6. `app/src/canvas/draw/<name>.ts` — port `draw()` (Phase 5+ only; model can land
   first).

### 8.2 Worked example — ResistorElm (do Phase 1 exactly like this)

```ts
// elements/resistor/model.ts
export class ResistorElm extends CircuitElm {
  resistance = 100;
  constructor(t?: Tokenizer) { super(t); if (t) this.resistance = t.nextDouble(); }
  getDumpType() { return "r"; }
  stamp(e: Stamper) { e.stampResistor(this.nodes[0], this.nodes[1], this.resistance); }
  calculateCurrent() { this.current = (this.volts[0] - this.volts[1]) / this.resistance; }
  serialize(w: TokenWriter) { w.push(this.resistance); }
  params(): ParamSpec[] {
    return [{ kind: "number", key: "resistance", label: "Resistance (ohms)",
              min: 1e-6, allowSlider: true }];
  }
}
```

Golden fixture `resistor-divider`: rail 10 V → R1 1k → node `mid` (labeled) → R2 2k
→ ground; assert `mid ≈ 6.667 V` every step (also a direct unit test — golden files
are for dynamics; trivial DC values get plain asserts too).

---

## 9. ExtChip in the palette (Phase 4/6 detail — the point of the project)

- Palette category **Co-simulated chips** with two cards (extensible via
  `catalog.ts`):
  - **FPGA — Tang Nano 9K (fpgasim)**: default source = 27 MHz divider blinky,
    default pins auto-adopted from the Verilog top after first Apply, bridge default
    `ws://localhost:3100`.
  - **MCU — STM32 Blue Pill (mcusim)**: default source = PC13 blinky C with
    `LOCKSTEP_PINS("PC13:out")`, engine `mainline`, bridge `ws://localhost:3101`.
- Placing a card creates an `ExtChipElm` with the preset; the drawer (§4 Phase 6)
  opens automatically for a fresh chip.
- Electrical semantics identical to the Java element: inputs sampled at
  `> highVoltage/2` (3.3 V family default), outputs driven 0/3.3 V push-pull via
  per-output voltage sources; quantum pacing + pause exactly as
  `bridge/client.ts` dictates (one step in flight; pause at one-quantum skew;
  resume on reply/error/ended — the client's unit tests already pin this).
- Serialization: keep dump type 460 and the Java token order
  (`url pinspec quantum engine source`, escaped) so circuits made with the GWT tool
  load unchanged.
- Status surfaces: chip body tint by status (grey unconfigured / amber compiling /
  green running / red error) + first error line under the chip; full log in drawer.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Nonlinear convergence differs from oracle (iteration order, damping) | Port `limitStep`/damping byte-faithfully; nonlinear tolerance tier (1e-3); divergences documented, never patched around silently. |
| Row-simplification port bugs corrupt matrices silently | Property test: for each golden fixture, dump the stamped matrix from both engines at t=0 (add temporary oracle hook if needed) and diff once during Phase 1 bring-up. |
| Canvas perf on big circuits | Falstad redraws everything per frame and survives; measure with the largest corpus circuit; only then consider dirty-rect. |
| Adaptive timestep behavior mismatch (non-golden mode) | Not equality-tested; behavioral tests only (stability on stiff fixture, no NaN). Golden mode always fixed-dt. |
| `CustomCompositeElm` (subcircuits) needed earlier than Tier 2 | UnknownElm preserves them; if scope.io corpus needs them, pull into Phase 7 triage. |
| scope.io regression at switchover | Embed shim keeps the `window.CircuitJS1` surface; staging test before swap; GWT build stays deployable until sign-off. |
| Sonnet context drift across sessions | §2 ritual + §12 checklist + phase gates; vault notes for anything surprising. |
| GWT oracle patch cannot compile locally (no maven egress in sandbox) | CI compiles on push; keep the patch minimal; recorder runs against `site/` build produced by CI artifact if needed. |

---

## 11. What explicitly does NOT change

- fpgasim/mcusim repos: bridge servers, harness/glue codegen, sandbox posture,
  Dockerfiles, their standalone UIs (still embedded in scope.io /tools today).
- `docs/bridge-protocol.md` (additive evolution only, version-bumped).
- The vault conventions and the workspace core loop.

---

## 12. Live progress checklist (tick as you go; keep honest)

- [ ] P0 scaffolding + workspaces green
- [ ] P0 oracle stepSim patch merged, CI green
- [ ] P0 recorder + ≥15 deterministic fixtures
- [ ] P1 lu/analyze/stamp/run ported; matrix-diff bring-up check done
- [ ] P1 linear elements + text I/O; gate green
- [ ] P2 nonlinear set; gate green
- [ ] P3 digital + ChipElm; gate green
- [ ] P4 bridge client + ExtChip + engine integration tests green
- [ ] P5 editor usable end-to-end; smoke suite green
- [ ] P6 scopes + ExtChip drawer + event lanes; live demo circuit committed
- [ ] P7 corpus 100% parse/round-trip; priority Tier-2 triage agreed
- [ ] P8 embed shim + deploy + sign-off + GWT retirement decision

### 2026-07-14 session note (not a gate sign-off — see caveats)

Found on session start: the previous session's uncommitted work past
`332d4973` had been wiped by a `git reset` (confirmed via reflog: `HEAD@{0}:
reset: moving to HEAD` right after the commit, no target-commit change). The
gitignored `web/engine/dist/` build output and a Next.js SSR chunk in
`web/app/.next/` survived the reset (untouched by `git reset --hard`) and were
used to reconstruct the lost TypeScript. This is now committed... **except it
isn't** — `.git/index.lock` in this checkout is stale and cannot be removed
from the Cowork sandbox (file deletion is blocked in mounted project folders).
Someone needs to `rm .git/index.lock` from an actual terminal before any of
this — or anything else — can be committed here.

What's in `web/engine/src/` right now (typechecks, `npm test` green, 10
tests):
- Core: `stampNonLinear` + `t/timeStep/converged/subIterations` added to the
  `Stamper` interface; `CircuitEngine.clear()/setup()`; `startIteration`/
  `stepFinished` now thread the stamper through (elements need it).
  `CircuitElm.setVoltageSource()` default now assigns `voltSource` (Java
  `CircuitElm.java:683-685` is not a no-op — the previous draft's op-amp/gate/
  logic-input/inverter would have had a permanently-undefined `voltSource`
  without this). `preStamp()`/`allocNodes()` now zero-fill `volts[]` (Java
  arrays zero-init automatically; JS doesn't — without this, diode/transistor/
  mosfet/op-amp read `undefined` → `NaN` into the matrix on the first
  sub-iteration of a circuit's very first step).
- Elements: wire, ground, resistor, voltage/rail/clock, switch, switch2 (new),
  capacitor, inductor, current (new), pot, diode, LED, transistor, mosfet,
  op-amp, the AND/OR/NAND/NOR/XOR/XNOR gate family, logic input/output,
  inverter (new).
- Bugs fixed against the Java oracle before committing: LogicInputElm dump id
  was `'i'` (that's CurrentElm's id — collision), should be `'L'`.
  LogicOutputElm was `'O'`, should be `'M'`. XnorGateElm was `155` (that's
  DFlipFlopElm's id), should be `431`. OpAmpElm.stamp() had
  `stampMatrixVSNode`/`stampMatrixNodeVS` swapped for the node-2 KCL-row entry
  (row/col reversed vs. Java's `stampMatrix(nodes[2], voltSource, 1)`).

Still missing from Tier-1 (§A.1): OutputElm/ProbeElm, LabeledNodeElm, TextElm,
BoxElm, AmmeterElm, ZenerElm as its own class (the shared diode model supports
a breakdown voltage but nothing constructs one), the general ChipElm base
(separate from GateElm), DFlipFlopElm, JKFlipFlopElm, SevenSegElm,
CustomLogicElm. **Multi-post elements (op-amp, pot, gate family, switch2,
transistor, mosfet) have no `setPoints()`/`getPost()` geometry yet**, so they
can't actually be wired into a circuit built from x/y coordinates the way the
existing tests build 2-post circuits — only dump-type and isolated-method
tests exercise them right now. `io/falstadText.ts` (§7 — options line fields,
escape scheme, scope/hint lines, unknown-element preservation) is still just
the placeholder `core/parser.ts` (element lines + `$` timeStep only).

None of Phase 0's gates were touched this session: no oracle `stepSim` patch,
no golden-recorder, no fixtures beyond the one placeholder. So while a lot of
Tier-1 element *code* exists now, **the checklist above is intentionally still
all-unchecked** — nothing has been verified against the oracle, which is the
actual bar for a phase gate per §2 rule 2.

---

### 2026-07-14 session note, continued — multi-post geometry + a real connectivity bug

Added `setPoints()`/`getPost()` overrides for all six multi-post elements
(OpAmpElm, GateElm family, PotElm, TransistorElm, MosfetElm, Switch2Elm) plus
base-class geometry helpers (`interpPoint`/`interpPoint2`/`calcLeads`,
byte-for-byte incl. Java's `Math.floor(...+.48)` pixel bias). New
`test/multipost-geometry.test.ts` wires each of these into an actual circuit
by coordinate (rather than testing them in isolation), since that's the only
way to exercise `getPost()` the way a text-format loader would.

Found and fixed a foundational connectivity bug in the process, not specific
to any one element: `WireElm` had no `getConnectedPost()` override (fixed —
now returns the opposite endpoint per `WireElm.java`), but the deeper bug was
in `Analyzer.analyze()`'s ordering. `calculateWireClosure()` ran *before* the
`preStamp()` loop (which resolves `point1`/`point2` from raw x/y/x2/y2), so
any freshly-constructed `WireElm` not manually `.preStamp()`'d by the caller
had its wire-closure lookup silently keyed off the uninitialized `{x:0,y:0}`
default instead of its real endpoint. In real Falstad this can't happen —
`setPoints()` runs at UI placement/move time, long before analysis — but this
port has no interactive placement step yet, so `preStamp()` has to run
reactively, and it needs to run for *every* element before *any* analysis
step reads post coordinates, not just before node-list construction. Moved
the `preStamp()` loop from `makeNodeList()` to the top of `analyze()`, before
`calculateWireClosure()`. Symptom before the fix was nasty: not a crash at the
wire itself, but a matrix row for an unrelated node ending up all-zero
(singular matrix) several steps downstream — worth remembering if something
similar resurfaces.

All 15 tests green (`recovered-elements.test.ts` +
`multipost-geometry.test.ts` + pre-existing), `tsc --noEmit` clean. Still
uncommitted — `.git/index.lock` blocker from the previous note is unresolved.

---

### 2026-07-14 session note, continued again — commit landed; remaining Tier-1 P1 elements

The `.git/index.lock` blocker is a sandbox-level restriction (file deletion is
blocked in mounted folders; this session confirmed it's *specifically*
deletion, not writes). Worked around it instead of waiting on it:
`GIT_INDEX_FILE=/tmp/alt-index git read-tree HEAD && git add -A && git commit`
builds a commit against an alternate index, sidestepping `.git/index.lock`
entirely, since that lock only guards the default `.git/index` path. Landed as
`19ea4b09`. Then `cp /tmp/alt-index .git/index` (overwrite, not delete —
permitted) resynced the default index so `git status` is clean again. The
lock file itself still physically exists and still blocks *plain* `git add`/
`commit` run without the env var — someone still needs to `rm
.git/index.lock` from a real terminal for normal git usage to resume, but
nothing is blocked or at risk from this sandbox's side anymore.

Ported the rest of Tier-1's P1 rows (§A.1 #14-18): `OutputElm`/`ProbeElm`
(analog probes), `LabeledNodeElm`, `TextElm`/`BoxElm` (new shared `GraphicElm`
base, 0-post canvas annotations, dump-fields only — no renderer exists yet to
draw them), `AmmeterElm`. Also added `ZenerElm` (§A.1 #20, P2, grouped in
since it's a two-line subclass once `DiodeElm` exists: a nonzero default
breakdown voltage is all it changes).

Found two more real Analyzer bugs while wiring these in, both in the same
area as last note's wire-closure fix:

- `GroundElm` had no cross-instance merging at all — multiple ground symbols
  at different coordinates had no mechanism tying them together beyond
  `setGroundNode()`'s per-element singleton assignment (which, empirically,
  turned out to already be sufficient on its own — see test
  `GroundElm > multiple GroundElm instances...`). Ported Java's
  `firstGround`/`getConnectedPost()`/`resetNodeList()` mechanism anyway for
  fidelity and because `setGroundNode()`'s coverage of this may not extend to
  subcircuits once those exist. `LabeledNodeElm.resetNodeList()` and
  `GroundElm.resetNodeList()` are now called at the top of
  `Analyzer.calculateWireClosure()`, matching
  `SimulationManager.calculateWireClosure()`'s exact call order.
- `Analyzer.setGroundNode()`'s "no explicit ground -> alias the first voltage
  source's post to ground" fallback was missing Java's `!gotRail` guard
  (`SimulationManager.java:509`). This is likely the *actual* root cause of
  last note's op-amp-follower crash (the test was fixed at the time by adding
  an explicit `GroundElm`, which papered over this rather than fixing it) —
  without the guard, any rail-only circuit with no explicit ground gets its
  own rail's node incorrectly aliased onto `CircuitNode.ground`. Added
  `CircuitElm.isRail()` (false by default, true on `RailElm`) and the missing
  `!gotRail` check. Covered by a new regression test constructing exactly
  that circuit shape with no `GroundElm` at all.

Also added base-class defaults found missing while cross-checking
`CircuitElm.java`: `getVoltageDiff()` (`volts[0]-volts[1]`) and
`getConnectedPost()` (Java's real default is `point2`, unconditionally — not
`null`; the `null` default in this port before now was a guess, and the wrong
one. It happened to be harmless so far because every element that sets
`isRemovableWire()=true` already has its own override, but it was one
mis-set flag away from silently repeating this note's whole bug class).

All 26 tests green (`new-elements.test.ts` (11, new) + everything from
before), `tsc --noEmit` clean.

Still not ported: DFlipFlopElm(155), JKFlipFlopElm(156), SevenSegElm(157),
CustomLogicElm(208) — Tier-1 §A.1 rows 33-36, P3. `io/falstadText.ts` (§7) is
still the placeholder parser. No oracle/golden-fixture verification has
happened yet this session either — same caveat as every note above: checklist
stays unchecked.

---

### 2026-07-14 session note, continued a third time — first-cut canvas editor

Pontsho asked to see the app running; it was the untouched `create-next-app`
scaffold (expected — nothing had wired `web/app` to `web/engine` yet). Built a
first slice of Phase 5 rather than the full 3-4 session scope: a real,
usable canvas editor for every Tier-1 element ported so far, deliberately
smaller than §4 Phase 5's full task list (no pan/zoom, no undo/redo, no
moving an already-placed element, no schema-driven edit dialogs, no
file open/save, no scopes) — a foundation to build the rest of Phase 5/6 on,
not Phase 5 itself signed off.

What exists now, all under `web/app/src/`:
- `engine/store.ts` — the single `CircuitEngine` instance the plan's §3.2
  seam describes, owned outside React, exposing `subscribe`/`getVersion` for
  `useSyncExternalStore` plus `addElement`/`removeElement`/`reanalyze`/
  `run`/`stop`/`step`, all wrapped so a thrown singular-matrix/convergence
  error becomes a status message instead of crashing the render loop.
- `canvas/draw.ts` + `CircuitCanvas.tsx` — per-element draw functions keyed
  by `getDumpType()` (not `instanceof`, deliberately -- `NandGateElm extends
  AndGateElm`, `LEDElm`/`ZenerElm extend DiodeElm`, `ClockElm extends RailElm
  extends VoltageElm`, so an instanceof chain would need careful subclass-
  first ordering everywhere; dump-id keys sidestep that entirely). Body
  shapes are simplified (zigzag resistor, coil inductor, plate capacitor,
  triangle diode/LED/Zener, generic gate boxes, generic 3-terminal circle for
  transistor/mosfet) rather than pixel-accurate ports of Java's `draw()`
  methods -- those are a real future task, not attempted here. Leads are
  computed by calling `elm.calcLeads()` at draw time for elements that don't
  already do it in `setPoints()`, matching how Java's own simple elements
  (e.g. `ProbeElm.draw()`) call `calcLeads()` lazily rather than precomputing
  it.
- `palette/palette.ts` — placeable Tier-1 elements grouped into simplified
  categories (not yet the full `Menus.java` tree from plan §5 task 4), built
  on `createElement()` (the same dump-id factory a loaded circuit uses) so
  there's one construction path for both.
- Interaction, intentionally minimal: a single drag gesture places any
  element (click without dragging gets a default 3-grid-cell span rather
  than a degenerate zero-length element); click selects via nearest-segment
  hit-testing; Delete/Backspace removes the selection. No element-moving yet
  -- documented as a gap, not silently missing.
- `toolbar/Toolbar.tsx`, `inspector/Inspector.tsx` — run/stop/step/speed,
  and a generic field-dump inspector (dump type, V, I, plus any of a fixed
  list of common fields the selected element happens to have) standing in
  for the schema-driven `<ElementDialog>` plan §5 task 5 describes.

Also: added `web/engine/src/index.ts` (didn't exist -- `engine/package.json`
`"main"` pointed at a file that had never been created), added
`@fulgurlab/engine` as an `app` dependency, added `next.config.ts`
`transpilePackages` (Next won't compile a workspace package's raw TS
otherwise). Dropped `next/font/google` (Geist/Geist Mono) from `layout.tsx`
in favor of a system font stack -- fonts.googleapis.com isn't reachable from
this sandbox; `next dev` fell back silently, but `next build` hung
indefinitely on it even with telemetry disabled and both bundlers (webpack
and Turbopack). Note for next session: **`next build` still hangs in this
sandbox even after the font fix**, reproducibly, past 40+ seconds with no
output beyond the version banner -- root cause not found yet (isolated to:
not fonts, not telemetry, not Turbopack-specific). `next dev` compiles and
serves correctly and `tsc --noEmit`/`eslint` are both clean, so the code
itself checked out by every means available in this sandbox, but a real
`next build` pass (the actual Phase 5 gate criterion) still needs to be run
somewhere that isn't this sandbox before calling it verified.

No interactive (mouse-driven) testing was possible from this sandbox either
-- puppeteer is installed in `tools/golden-recorder` but has no downloaded
Chromium binary here, and Claude-in-Chrome-style browser control drives
Pontsho's actual machine, which can't reach a server running inside this
sandbox. Verified via `next dev` + curl (loads, serves expected markup, no
server errors) and careful manual review instead. This is the first real
thing to click around in this repo -- worth Pontsho trying it locally
(`cd web/app && npm run dev`) before trusting the interaction details.

---

### 2026-07-15 session note — scope.io-style colors + real SVG symbols

Pontsho: "for the style, use the style in scope.io's circuitjs iframe. next,
use the component (svg or equivalent) for the components in fulgurlab." Two
asks, both landed: match Falstad's actual palette, and replace the crude
Canvas2D body shapes from the previous session's note with real vector
symbols. Didn't web-search scope.io's embed — went straight to the Java
oracle, since scope.io just iframes stock CircuitJS1 with default settings,
and the defaults are already sitting in the source tree.

**Color scheme (`web/app/src/canvas/theme.ts`, new file).** Extracted from
`CircuitElm.java`/`Color.java`/`UIManager.java` rather than guessed: background
`#111`; `positiveColor`/`negativeColor`/`neutralColor` = green/red/gray with
`voltageRange = 5` (±5V is full saturation, not the ±20V the previous
session's `draw.ts` used); `selectColor` = cyan; `currentColor` = yellow;
blending is a plain linear RGB mix (`Color.java`'s 3-arg constructor:
`r = c1.r*(1-mix) + c2.r*mix`), not HSB. `strokeFor(volts, selected, hovered)`
layers selected (cyan) and hovered (a lavender not in Falstad — this port's
own affordance, since Falstad has no mouse-hover state) over the voltage
gradient. Verified end-to-end (see below), not just unit-level: a resistor at
-5V/0V/+5V in each of the three interaction states renders full-red/gray/
full-green with cyan or lavender correctly overriding when selected/hovered.

**SVG symbol library (`web/app/src/canvas/symbols.tsx`, new file,
~370 lines).** Every element renders as a `<g transform="translate(x y)
rotate(deg)">` wrapping locally-authored (horizontal, point1 at origin)
path/line/shape data — mirroring Falstad's own Graphics.translate()+rotate()-
then-draw-in-local-space convention, rather than the world-space `dpx1/dpy1`
perpendicular-offset math the previous session's `draw.ts` used. Geometry
constants (zigzag peaks, plate gaps, arc radii, lead lengths) came from a
sub-agent's read of the Java `draw()` methods, cross-checked against this
engine's own `setPoints()` implementations where they overlap (e.g.
`GateElm.setPoints()`'s input-fanout loop is replicated *exactly*, same `i0`
sequence, in `gateInputOffsets()` — so drawn input leads land precisely on
`getPost(i)`, not just approximately near it).

Every Tier-1 dump type has a real symbol now: resistor zigzag, capacitor
plates, inductor coil arcs, diode/LED/zener triangle+bar (color-coded
cathode), battery/rail/clock bars, switch lever, ground hash marks, pot
(resistor body + world-space wiper leg to the real `getPost(2)`), opamp
triangle with +/- labels, transistor circle+leads, IEC-style gate rectangles
(`&`/`≥1`/`=1`/inversion bubble for NAND/NOR/XNOR/inverter — chose one
consistent convention rather than mixing ANSI curved AND-shapes with IEC OR
labels), current source (circle+arrow, its own symbol, not a re-skinned
battery), probe/ammeter (inline circled V/A meter), labeled node (label text
set *above* the post marker, not crammed inside a 9px circle), text and box
graphics. Known, accepted simplifications: Falstad's `dsign` world-orientation
mirror isn't replicated (a component may not visually flip the same way Java
would when placed right-to-left); MOSFET reuses the BJT circle+leads symbol
rather than its own gate/channel glyph.

`CircuitCanvas.tsx` was rewritten around this: an `<svg>` root (dot-grid via
an SVG `<pattern>`, not a per-pixel fill loop) mapping `engineStore.engine
.elmList` to `<ElementSymbol>` per element, keeping the exact same
mouse-driven place/select/delete logic and `distanceToElement` hit-testing
from the previous session unchanged. `draw.ts` is trimmed to just `GRID_SIZE`/
`snap`/`distanceToElement` — the Canvas2D `DRAWERS` table and per-shape draw
functions are gone, superseded by `symbols.tsx`.

**Verification method (new this session, worth reusing).** Interactive
browser testing is still not possible from this sandbox (unchanged from the
last note), but static analysis plus a dev-server curl isn't a strong enough
check for *visual* correctness — so this session added a headless
render-and-rasterize harness instead of relying on code review alone: an
esbuild-bundled script (`react-dom/server`'s `renderToStaticMarkup`)
constructs one real instance of every Tier-1 dump type via the actual
`createElement()` factory, calls `elm.preStamp()` (matching what
`engineStore.addElement()` does — `setPoints()` doesn't run in the
constructor, only `preStamp()`, so skipping it renders everything collapsed
at the origin), renders each through the real `ElementSymbol`, and rasterizes
the combined SVG to PNG via `sharp` for actual eyeballing. Caught two real
bugs this way that code review missed: the current source was reusing the
battery symbol (fixed — dedicated circle+arrow `CurrentSourceBody`), and
`LabeledNodeElm`'s free-text label overflowed its marker circle (fixed —
moved above the marker in `LabeledNodeBody`). All 33 Tier-1 dump types render
without throwing; spot-checked ground's hash marks, the NAND bubble, and the
full selected/hovered/voltage color matrix by cropping and viewing the
raster directly. This harness only exists as ad hoc scratch files during
verification (`web/app/src/canvas/_verify_symbols.tsx` /
`_verify_bundle.cjs`) — this sandbox can't delete files in mounted folders,
so they're left neutered (`export {};` / empty) rather than gone; recreate
from this note's description if the check needs to be repeated rather than
resurrecting the emptied files.

**Sandbox finding worth flagging**: `next dev` (plain webpack) hung
indefinitely again this session past 40+ seconds — previously this was only
seen with `next build`. `next dev --turbopack` came up in ~1s and served the
page in ~3s total, no code changes involved, so this looks like a
sandbox/webpack-cold-compile speed issue rather than anything wrong with the
app. Worth defaulting to `--turbopack` for any future in-sandbox dev-server
checks here; plain `next build` (webpack, no turbopack flag for production
builds pre-Next-16) is still unverified in this sandbox per the last note.

---

### 2026-07-15 session note, continued — chrome rebuilt to match a pixel-exact reference

Pontsho uploaded a working mockup ("Simulator Premium.dc.html", a rendered
component-preview export) and said "this is what i meant for the style,
exactly this; without the grading icons and stuff." This superseded the
previous note's color-scheme interpretation (which had been reasoned from
the Java oracle's defaults, not this specific look) and, more substantially,
called for rebuilding the whole app shell: full-bleed canvas with floating
glassmorphic panels at the corners, not a bordered 3-column layout with a
fixed top bar.

**What changed, and why each call was made:**

- **Fonts**: reintroduced Geist/Geist Mono (dropped two sessions ago over
  the `next build` hang) via plain `<link>` tags in `layout.tsx` instead of
  `next/font/google` — this is literally how the mockup itself loads them,
  and fetches at browser runtime rather than Next's build pipeline, so it
  can't reproduce that hang. `globals.css` now hardcodes the dark palette
  (no more `prefers-color-scheme` light/dark branch — this app has exactly
  one look) and actually wires `--font-sans` into `body` (the old file
  defined the CSS var and then ignored it, using a hardcoded Arial stack).

- **`theme.ts` recalibrated, not discarded.** The mockup's circuit uses a
  flat, monochrome `currentColor: #4b5563` for every component at rest, with
  green (`#16a34a`) reserved for ground — quite different from Falstad's
  saturated rgb(128,128,128)-neutral scheme the last session ported. Rather
  than pick one or the other, this keeps Falstad's actual mechanism (linear
  RGB blend, ±5V full saturation, selected/hovered layered on top) but
  retargets the three blend endpoints to this palette: neutral is now
  `#4b5563` (exact mockup match at 0V), positive/negative are `#4ade80`/
  `#f87171` (green-400/red-400, toned down from pure RGB primaries to fit
  the muted register), select is `#22d3ee` (cyan-400), ground is a fixed
  `#16a34a` never subject to the voltage gradient. Added `overlayColor()` so
  any fixed-accent element (ground, and labeled-node's indigo) still yields
  to selected/hovered like every voltage-gradient element does — previously
  labeled-node's color was hardcoded and didn't respond to either. Canvas
  background is now the mockup's exact layered CSS (`CANVAS_BACKGROUND_IMAGE`/
  `_SIZE`: a 26px dot grid over a soft radial vignette, plus a separate inset
  box-shadow vignette layer) rendered as plain divs behind the SVG rather
  than the previous session's SVG `<pattern>` dot grid.

- **New `src/chrome/` package**: `icons.tsx` (stroke icons transcribed from
  the mockup's exact SVG path data), `IconButton.tsx` (shared ghost/outline
  circular button covering the toolbar + reset/fullscreen buttons),
  `FloatingToolbar.tsx` (top-left pill: Draw-wire / Scopes / Edit-select /
  More-tools), `PaletteFlyout.tsx` (the categorized 31-item picker opened
  from More-tools — the mockup doesn't show what's behind its chevron, so
  this panel's specific layout is this port's own design, built to match
  the same glass recipe), `StatusCluster.tsx` (top-right: time + running
  LED, reset, the big run/stop toggle, fullscreen), `SpeedSlider.tsx`
  (bottom-right: a custom drag-slider, not a native `<input type=range>`,
  matching the mockup's exact track/thumb rendering — maps 0-100% onto
  `engineStore.stepsPerFrame`'s existing 1-40 range).

- **Deliberately dropped** (per "without the grading icons and stuff"): the
  mockup's "Submit solution" button, "Reset to template" button, and its
  "Res·F" resonant-frequency reading — all specific to a graded-assignment
  context this app doesn't have. Kept "Reset simulation" (a real, general
  sim-control concept) and added `EngineStore.resetTime()` for it: stops the
  run loop, zeroes `engine.t`/`timeStepAccum`, re-stamps via `reanalyze()` --
  same circuit, fresh state, unlike `clear()` which deletes every element.

- **Inspector** (`src/inspector/Inspector.tsx`) rewritten as a floating
  glass card, bottom-left, returning `null` entirely when nothing's
  selected rather than showing a permanent empty-state sidebar — the
  mockup has no inspector to transcribe, so this is this port's own design
  choice, kept in the same glass language as everything else.

- **`page.tsx`** is now just `<CircuitCanvas>` plus the four floating
  components, absolutely positioned — no more flex column layout. The old
  `Toolbar.tsx`/`PaletteSidebar.tsx` are superseded and unused; left in
  place with a header comment explaining why (not deleted — this sandbox's
  standing file-deletion restriction, same as every other superseded file
  this project has hit).

**Verification.** Same two methods as the previous note, re-run against the
new code: the esbuild+react-dom/server+sharp headless-render harness (all
33 Tier-1 dump types, now specifically checking a selected element, a
hovered element, and ground, against the new palette) and a `next dev
--turbopack` + curl smoke test of the *whole* assembled page (chrome +
canvas together) confirming HTTP 200, no error markers, and every new
control's title text present in the markup. Additionally attempted to
download a real Chromium via `puppeteer browsers install chrome` this
session specifically to get an actual pixel screenshot of the glass/blur
chrome (CSS effects like `backdrop-filter` and layered gradients can't be
verified via SVG rasterization the way circuit symbols can) — blocked with
an HTTP 403 from this sandbox's network allowlist. So: the circuit-color
changes are visually confirmed pixel-by-pixel; the chrome layer's *values*
are confirmed correct by direct transcription against the mockup's source
and a clean render with no runtime errors, but its actual blur/glassmorphism
*appearance* has not been eyeballed from within this sandbox. Worth Pontsho
checking `cd web/app && npm run dev -- --turbopack` locally before trusting
the glass-panel look pixel-for-pixel.

---

## Appendix A — Tables

### A.1 Tier 1 (port in this order; Java file names in `client/`)

| # | Element | Java class | Dump id | Phase |
|---|---|---|---|---|
| 1 | Wire | WireElm | w | P1 |
| 2 | Ground | GroundElm | g | P1 |
| 3 | Resistor | ResistorElm | r | P1 |
| 4 | DC voltage / battery | DCVoltageElm (VoltageElm) | v | P1 |
| 5 | AC voltage | ACVoltageElm | (VoltageElm wf) | P1 |
| 6 | Rail / VCC | RailElm | R | P1 |
| 7 | Clock rail | ClockElm | (RailElm wf) | P1 |
| 8 | Switch | SwitchElm | s | P1 |
| 9 | SPDT switch | Switch2Elm | S | P1 |
| 10 | Capacitor | CapacitorElm | c | P1 |
| 11 | Inductor | InductorElm | l | P1 |
| 12 | Current source | CurrentElm | i | P1 |
| 13 | Potentiometer | PotElm | 174 | P1 |
| 14 | Analog output/probe | OutputElm / ProbeElm | O / p | P1 |
| 15 | Labeled node | LabeledNodeElm | 207 | P1 |
| 16 | Text | TextElm | x | P1 |
| 17 | Box | BoxElm | b | P1 |
| 18 | Ammeter | AmmeterElm | 370 | P1 |
| 19 | Diode | DiodeElm | d | P2 |
| 20 | Zener | ZenerElm | z | P2 |
| 21 | LED | LEDElm | 162 | P2 |
| 22 | NPN/PNP transistor | TransistorElm | t | P2 |
| 23 | N/P MOSFET | MosfetElm | f | P2 |
| 24 | Op-amp | OpAmpElm | a | P2 |
| 25 | Logic input | LogicInputElm | L | P3 |
| 26 | Logic output | LogicOutputElm | M | P3 |
| 27–32 | AND/OR/NAND/NOR/XOR/Inverter | AndGateElm … InverterElm | 150/152/151/153/154/I | P3 |
| 33 | D flip-flop | DFlipFlopElm | 155 | P3 |
| 34 | JK flip-flop | JKFlipFlopElm | 156 | P3 |
| 35 | 7-segment | SevenSegElm | 157 | P3 |
| 36 | Custom logic | CustomLogicElm | 208 | P3 |
| 37 | **External chip (FPGA/MCU)** | ExtChipElm | 460 | P4 |
| 38 | Sweep (freq source) | SweepElm | 170 | P7 triage |
| 39 | Var. voltage rail | VarRailElm | 172 | P7 triage |
| 40 | Tri-state buffer | TriStateElm | 180 | P7 triage |

(Verify each dump id against `getDumpType()` in the Java file when porting — the
letters/ids above are from the Java sources; treat the Java as authoritative.)

### A.2 Tier 2 (post-switchover backlog, roughly ordered by scope.io value)

Transformer, TappedTransformer, Relay, 555 Timer, Comparator/Schmitt pair, ADC, DAC,
Counter(+w/load), Ring counter, Latch, SIPO/PISO shift registers, Mux/Demux,
SRAM/ROM, Full/Half adder, Bus transceiver/splitter, **CustomCompositeElm
(subcircuits — biggest single item)**, Crystal, PolarCapacitor, JFET, SCR, Triac,
Optocoupler, CCVS/CCCS/VCVS/VCCS, TransLine, Memristor, TunnelDiode, Varactor,
Monostable, DelayBuffer, AM/FM sources, Antenna, Sequence generator.

Tier 3 = the remaining long tail (audio I/O, motors, spark gap, unijunction, diac,
Darlington, 14/16-seg, data recorder, …) — on demand.

### A.3 Golden fixture list (minimum; grow freely)

Linear (P1): resistor-divider · rc-lowpass-step · rl-step · lrc-ring (`tests/lrc.txt`)
· cap-charge (`tests/capac.txt`) · wheatstone · current-source-into-r · pot-sweep ·
switch-toggle-transient · ac-rail-into-rc.
Nonlinear (P2): diode-clipper · bridge-rectifier (`tests/fullrect.txt`) · zener-reg ·
led-series-r · bjt-common-emitter · mosfet-inverter-dc-sweep · opamp-follower ·
opamp-integrator.
Digital (P3): gate-truth-tables · dff-divider · tflipflop corpus (`tests/tflipflop.txt`)
· 7seg-counter (`tests/7seg.txt`) · custom-logic (`tests/custom.txt`) ·
schmitt (`tests/schmitt.txt`, if Tier-1-only variant possible).

### A.4 Commands

```bash
# oracle
python3 -m http.server 8123 --directory site &
node tools/golden-recorder/record.mjs --all          # writes web/engine/test/golden/

# engine
npm -w web/engine run test                            # vitest (unit + golden)
npm -w web/engine run typecheck

# app
npm -w web/app run dev                                # http://localhost:3000
npm -w web/app run test && npm -w web/app run build

# bridges (for ExtChip work; from sibling repos)
(cd ../fpgasim && npm run bridge)                     # :3100
(cd ../mcusim  && npm run bridge)                     # :3101

# engine ↔ real-backend integration (gated on toolchains)
npm -w web/engine run test:integration
```
