# TODO — fulgurlab vs. backed-up circuitjs1

Findings from a functionality test and comparison run on **2026-07-29**.

- **fulgurlab** — `/projects/fulgurlab`, HEAD `ff1d49b0`, 40 commits
- **circuitjs1 (backup)** — `/projects/_originals-backup-20260713/circuitjs1`, HEAD `a7aa083`, 6 commits

## Relationship

fulgurlab **contains** circuitjs1's HEAD (`a7aa083`) and is **34 commits ahead**. Zero files deleted — the divergence is purely additive:

| Area | Change |
|---|---|
| `web/` | 129 new files — React/Next + TypeScript engine rewrite (~8.2k LOC engine, ~8.3k LOC app) |
| `tools/golden-recorder/` | 3,338 new files — the oracle recorder (3,330 of them are `node_modules`) |
| `src/` (Java) | +1 file `ExtChipElm.java`; 3 files touched (`JSInterface`, `Menus`, `SimulationManager`) |
| `war/` | +`fulgur-bridge.js`; `circuitjs.html` gains one `<script>` tag |
| `jstests/`, `integration-tests/`, `docs/` | new bridge test + protocol docs |

The Java engine is otherwise **byte-identical** in both repos: 150 shared `*Elm.java`, identical `build.gradle`. The backup holds nothing fulgurlab lacks — it is safe to treat as a pure ancestor snapshot.

## Test results

| Suite | Result |
|---|---|
| `web/engine` (vitest) | **186 passed / 14 files** |
| `web/app` (vitest) | **32 passed / 2 files** |
| `jstests/` (bridge unit) | **6 passed** |
| `integration-tests/` | **3 skipped, 0 run** — needs live fpgasim/mcusim backends |
| `web/app` `tsc --noEmit` | clean |
| `web/app` `next build` | **succeeds** — compile mode only, 4.7s, 120 kB first-load JS (see P1-3b) |
| `web/engine` `tsc --noEmit` | **1 error** (see P2-1) |
| Gradle/GWT build (both repos) | **not verifiable here** — wrapper needs `services.gradle.org`, blocked offline |
| Golden traces vs Java oracle | **5/5 pass**, worst case 0.04% of tolerance budget |

Numerical parity with the Java oracle is genuinely tight — max absolute error per fixture:

```
bjt-divider       8.882e-16     lrc-ring        4.997e-09
diode-halfwave    4.959e-09     rc-lowpass      4.975e-09
resistor-divider  3.333e-12
```

---

# P0 — Correctness bugs

## [ ] P0-1. Dump type `164` is mapped to the wrong element

`web/engine/src/core/factory.ts:26` maps `'164' → ClockElm`. In Java, **164 is `CounterElm`** (`CounterElm.java:174`). `ClockElm` has `getDumpClass() → RailElm.class`, so it never dumps as 164 at all — it dumps as `'R'`.

Effect: every `164 ...` line silently loads as a 1-post `ClockElm` instead of a multi-post counter chip. No warning is emitted, because the factory only warns on *unknown* ids.

Verified directly — parsing a real corpus line yields:

```
164 384 288 416 288 0 4 0 0 5 5 false   ->  ClockElm  postCount=1
```

This is almost certainly the root cause of the two `Singular matrix!` results in the corpus sweep: the only two corpus files containing `^164 ` lines are `tests/7seg.txt` and `tests/custom.txt` — **exactly** the two files the sweep reports as singular.

Fix: drop the `'164'` entry (ClockElm is a palette preset of `'R'`, like ACRail/SquareRail), then port `CounterElm` for real, or let 164 fall through to preserve-verbatim.

## [ ] P0-2. `makeSite` never copies `fulgur-bridge.js` — the co-simulation feature is dead in any built site

`site/circuitjs.html:159` loads `<script src="fulgur-bridge.js">`, but `build.gradle`'s `makeSite` task (lines 139–147) copies only `*.html`, `*.css`, images, `*.txt`, `*.xml` and `font/**` from `war/`. **No `*.js` include.**

Confirmed on disk: `site/` contains zero root-level `.js` files while `war/` has four (`fulgur-bridge.js`, `lz-string.min.js`, `canvas2svg.js`, `service-worker.js`).

The missing `lz-string.min.js` is a pre-existing upstream bug — `build.gradle` is identical in both repos and the backup's `site/` is equally empty. But fulgurlab is the one that now *depends* on it: the entire ExtChip bridge 404s in a deployed build.

Fix: add `include '**/*.js'` to the `from('war')` block in `makeSite`.

## [ ] P0-3. `reset` / `reset_done` are specified but implemented nowhere

`docs/bridge-protocol.md` lines 47 and 57 define `reset` (client→server) and `reset_done` (server→client). Neither `war/fulgur-bridge.js` nor `web/app/src/extchip/client.ts` handles them — both implement exactly six inbound cases (`welcome`, `created`, `stepped`, `ended`, `error`, `disposed`) and four outbound (`hello`, `create`, `step`, `dispose`).

Either implement reset on both clients, or strike it from the spec. Right now "restart the same build from t=0" requires a full dispose/create round-trip, which recompiles.

---

# P1 — Coverage gaps

## [ ] P1-1. 71 of 126 Java element types have no TS implementation (44% ported)

The TS factory registers 55 dump ids; Java defines 126. The 71 unregistered ids (plus `164`, registered but wrong — P0-1) grouped by likely priority:

**Digital / sequential (blocks most of the Java corpus):**
`155 DFlipFlop` · `156 JKFlipFlop` · `193 TFlipFlop` · `164 Counter` (id occupied by the P0-1 mis-mapping) · `421 Counter2` · `163 RingCounter` · `168 Latch` · `184 Multiplexer` · `185 DeMultiplexer` · `432 AnalogMux` · `186 PisoShift` · `189 SipoShift` · `195 HalfAdder` · `196 FullAdder` · `197 SevenSegDecoder` · `188 SeqGen` · `413 SRAM` · `436 ROM` · `424 DataInput` · `433 BusSplitter`

**Analog / passive:**
`84 Transformer` · `169 TappedTransformer` · `406 CustomTransformer` · `106 Jfet` · `400 Darlington` · `109 Memristor` · `110 Noise` · `171 TransLine` · `173 Triode` · `175 TunnelDiode` · `176 Varactor` · `177 SCR` · `203 Diac` · `206 Triac` · `209 PolarCapacitor` · `412 Crystal` · `417 Unijunction` · `409 OpAmpReal`

**Relays / switches / motors:**
`178 Relay` · `425 RelayCoil` · `426 RelayContact` · `416 MBBSwitch` · `429 DPDTSwitch` · `430 CrossSwitch` · `415 DCMotor` · `427 ThreePhaseMotor` · `428 MotorProtectionSwitch` · `404 Fuse`

**Meters / outputs / misc:**
`216 OhmMeter` · `420 Wattmeter` · `368 TestPoint` · `419 DecimalDisplay` · `405 LEDArray` · `407 Optocoupler` · `181 Lamp` · `350 ThermistorNTC` · `374 LDR` · `187 SparkGap` · `423 Line` · `210 DataRecorder` · `211 AudioOutput` · `411 AudioInput` · `418 ExtVoltage` · `408 StopTrigger` · `165 Timer` · `194 Monostable` · `158 VCO` · `161 PhaseComp` · `166 DAC` · `167 ADC` · `179 CC2` · `410 CustomComposite`

`410 CustomComposite` is the highest-leverage single item — it's the subcircuit mechanism, and 16 Java files reference it against 0 in the rewrite.

## [ ] P1-2. Palette exposes 61 entries vs the Java draw menu's 141 element classes

`web/app/src/palette/palette.ts` lists 61 items (some are presets sharing a dump type). `Menus.java` references 141 distinct `*Elm` class names. The palette file itself flags this: *"full parity with that tree is a later refinement."* Worth re-checking once P1-1 lands, since palette entries are cheap once the element exists.

## [ ] P1-3. Whole app subsystems have zero tests

Only `kicad/` and `extchip/` have test files. **No tests at all** for `canvas/` (1,095 + 984 LOC — the two largest files in the app), `engine/store.ts` (623 LOC, all 37 user-facing actions), `scope/` (495 LOC), `inspector/`, `palette/`, `chrome/`, `toolbar/`.

`engine/store.ts` is the highest-value target: `undo`/`redo`, `importText`/`exportText`, move transactions and selection are all untested and all easy to test headlessly.

## [ ] P1-3b. `web/app` `next build` is only verified in `compile` mode

The full build (compile + static generation) exceeded the sandbox's per-command budget, so it was verified with `--experimental-build-mode compile`, which passed cleanly. Worth confirming a full `next build` locally before relying on it in CI.

## [ ] P1-4. Golden-trace gate is thin

5 fixtures × 200 samples × **1 probe node each** = 1,000 compared values, all from linear/mildly-nonlinear circuits. Not covered: any digital element, opamp, MOSFET, multi-node comparison, adaptive-timestep behaviour under stiffness, or the `ended`/skew paths.

Given the recorder already exists (`tools/golden-recorder/record.mjs`), extending the fixture set is mostly mechanical — and it's the only defence against silent divergence like P0-1.

## [ ] P1-5. Integration tests never actually run

All 3 `integration-tests/bridge.integration.test.mjs` cases skip without live fpgasim/mcusim backends, so the fpgasim leg, mcusim leg and skew guard are unverified in CI. Consider a recorded-transcript fake backend so the client logic is exercised even when containers aren't available.

---

# P2 — Hygiene

## [ ] P2-1. `web/engine` fails `tsc --noEmit`

```
test/scope-element.test.ts(69,30): error TS2345: Argument of type 'ScopeElm' is not
assignable to parameter of type 'GroundElm | ResistorElm | RailElm'.
```

Vitest passes because it transpiles without typechecking. The union in the test helper needs widening (or a `CircuitElm` base type).

## [ ] P2-2. 3,330 `node_modules` files are committed under `tools/golden-recorder/`

`.git` is **113 MB** vs the backup's **3.6 MB** — a 31× blowup from this alone. `tools/golden-recorder/` has no `.gitignore`, unlike `web/` which correctly ignores `node_modules/`.

Add `tools/golden-recorder/node_modules/` to `.gitignore` and `git rm -r --cached` it. (Puppeteer is a heavy dep; a lockfile is enough to reproduce.)

## [ ] P2-3. 27 commits unpushed on `master`

Everything from the React rewrite onward exists only locally. The backup snapshot is the sole redundancy.

## [ ] P2-4. Stale branch `master.lock.stale-2026-07-14`

Left over from a lock incident (`f5ba4d4a`). Verify it's fully merged into master, then delete.

## [ ] P2-5. `web/engine/dist/` is stale

Contains 17 element files against `src/`'s 40. It's gitignored so it's local-only noise, but anything importing from `dist/` instead of `src/` silently gets a half-built engine. Delete it, or wire a real build step.

## [ ] P2-6. `web/app/README.md` is still the `create-next-app` boilerplate

Root `README.md` documents the rewrite; the app README does not.

---

## Not blockers, but worth deciding

- **Two hand-maintained bridge clients.** `war/fulgur-bridge.js` (261 LOC, Java host) and `web/app/src/extchip/client.ts` (396 LOC, React host) independently implement proto v1. They agree today — both `PROTO = 1`, same six inbound cases — but P0-3 shows the spec has already drifted from both. A shared JS core, or a conformance test run against both, would stop the next divergence.
- **Dump format is deliberately not byte-compatible with Java's** (`docs/react-rewrite-plan.md`, audit item 5). Fine while the rewrite is standalone; needs resolving before any scope.io migration, since Java can't reload TS-written saves.
- **`/` renders as `ƒ (Dynamic)`** in the Next build. For a client-side simulator, static export would drop the server requirement entirely.
