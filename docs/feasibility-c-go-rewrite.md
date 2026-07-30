# Feasibility study — rewriting the circuit engine in C or Go

Question: can/should fulgurlab's engine be rewritten in C or Go, and what speedup would that buy? Findings below are based on reading the current dense-LU solver in both languages, benchmarking the live TS engine, and checking prior art for compiled circuit simulators in the browser.

## TL;DR

Don't rewrite the browser engine in C or Go for speed — the benchmark below shows the JS/TS engine already does 12k–65k steps/sec on realistic circuit sizes, far above what a 60fps UI needs. The actual performance ceiling that matters (large nonlinear circuits, 150+ nodes) is an **algorithm** gap, not a language gap: this fork's own Java engine already solves it with a sparse solver that the TS port never carried over. Fix that first; it's a few days of work with an existing reference implementation, versus months for a rewrite.

C *is* a legitimate choice, but only if there's a concrete reason to want a native/CLI/server build (batch verification, headless simulation at scale) — via Emscripten to WASM for the browser, it's a well-trodden path (ngspice itself has been ported this way at least three times independently). Go is a weaker fit for the in-browser case specifically and has no prior art in this domain; it's worth considering only for a pure server-side batch-simulation service, decoupled from the UI entirely.

## What "rewrite" would have to mean

The React/Canvas UI (`web/app`, ~8,300 LOC) stays TypeScript regardless of language choice — nobody rewrites drawing code, undo/redo, or the KiCad panel in C. "Rewrite the engine" means the ~8,245 LOC in `web/engine/src` (parser, dense LU solver, per-element `stamp()`/Newton logic) becomes a compiled module the UI calls into every animation frame, either via WASM (browser) or as a native process (server/CLI). That boundary is the same regardless of C or Go, and it's the main integration cost either way: every step, the UI needs per-element voltages/currents back out for drawing and the scope — a marshaling layer across the JS↔native boundary that doesn't exist today at all.

## Where the time actually goes today

Read both solvers before assuming anything:

- **TS engine** (`web/engine/src/core/lu.ts`): dense Crout LU, `O(n³)` factor / `O(n²)` solve, unconditionally — matches upstream Falstad's original algorithm.
- **Java engine** (this fork, `SimulationManager.java` + `matrix/SparseLU.java`, EJML-derived): **dispatches** — dense below `SPARSE_THRESHOLD = 150` nodes, a real sparse CSC LU (search-based DFS reordering, no fill-in tracking) above it. The TS port only ever ported the dense path.

For the great majority of fulgurlab circuits (the whole corpus tops out at 75 elements / ~40 nodes) this makes zero practical difference — Java would use dense too. It matters only for large circuits, which is exactly the regime a rewrite-for-speed argument would be about.

### Benchmark (Node, `web/engine`, dense path, single core)

Two synthetic ladder circuits, 500 steps each, after one warm-up step:

**Linear RC ladder** (resistor + cap per stage — matrix factored once, solved every step):

| nodes | steps/sec | µs/step |
|---|---|---|
| 8 | 65,405 | 15.3 |
| 43 | 322,397 | 3.1 |
| 83 | 117,116 | 8.5 |
| 153 | 40,561 | 24.6 |
| 303 | 12,301 | 81.3 |

**Diode ladder** (forces Newton re-factoring every sub-iteration — worst case for a nonlinear circuit):

| nodes | steps/sec | µs/step |
|---|---|---|
| 8 | 67,991 | 14.7 |
| 43 | 22,070 | 45.3 |
| 83 | 4,213 | 237.4 |
| 153 | **757** | 1320.6 |

The nonlinear case degrades fast once Newton re-factors a growing dense matrix every sub-iteration (80→153 nodes, 1.9× the size, is 5.6× slower) — this is the `O(n³)`-per-Newton-step cost the Java fork's sparse solver exists to avoid. Small-n numbers (8→43 nodes get *faster*, not slower) are V8 JIT warm-up noise, not signal — the trend at scale is what matters.

**Context for these numbers:** a browser sim only needs to keep up with ~60 animation frames/sec, each covering some number of sub-steps (fulgurlab's default `timeStep` is 5µs; a few hundred sub-steps per frame is typical). Even the nonlinear worst case at 150 nodes (757 steps/sec) sustains ~12 sub-steps/frame at 60fps — tight for a "many hundreds of gates" circuit, comfortable for anything smaller. The realistic corpus (see the earlier functionality TODO) never approaches this regime.

## Option A — C, compiled to WASM

**Prior art exists and is mature**: ngspice — a full C SPICE engine, decades of Fortran/C numerics — has at least three independent Emscripten/WASM browser ports live today (ngspiceX, EEcircuit, Nonspice), one of them updated within the last few months. This is not a novel idea; the toolchain (Emscripten) and pattern (thin JS shim calling into a WASM numeric core, values marshaled per frame) are established.

**Expected speedup**: recent (2025) benchmarking across various workloads puts WASM at roughly 1.3–2× JS for typical numeric code, only reaching the often-quoted "8–10×" figures for embarrassingly-parallel, SIMD-friendly work (image/array processing). Dense LU factorization on small (n<100), branchy, pivoting-heavy matrices is not SIMD-friendly — expect the low end of that range, i.e. a solid but unspectacular constant-factor win, not an order of magnitude.

**Effort**: `web/engine/src` is 8,245 LOC total (2,225 core + 6,011 elements incl. shared base classes) for 55/126 elements; per-element files alone average ~103 LOC each, so reaching current feature parity is already ~7,300 more lines before a rewrite even starts. A C port starts that over from zero, plus: hand-written (de)serialization across the WASM boundary (no `JSON.stringify` shortcut — every element field crossing the boundary needs an explicit layout), and every one of the 194 existing vitest cases either re-implemented in a C test framework or run against the WASM build through a Node harness.

**When it's worth it**: if there's a real desire for large circuits (hundreds of gates — the digital corpus, PLA-scale things) to stay responsive, or for a native/CLI batch-simulation binary outside the browser entirely (this fork already runs headless containers for the fpgasim/mcusim bridge — a C or C++ batch engine fits that shape naturally). Not worth it purely to make small-circuit stepping faster; it's already fast.

## Option B — Go

**No prior art found** for a Go-based circuit simulator running in-browser — worth noting on its own, since ngspice's WASM ports show the pattern is popular for C/C++ engines specifically.

**Binary size**: standard `go build` targeting `js/wasm` produces multi-MB binaries even for trivial programs (~1.9MB unstripped for "hello world", commonly cited well over 10MB for real programs) because it drags along Go's runtime, scheduler and GC. **TinyGo** (LLVM-based, targets constrained environments) shrinks this roughly 10–20× — but it doesn't fully support Go's standard library (`encoding/json`, `net/http`, reflection-heavy code), which is a real constraint for anything touching the parser or JS interop layer.

**GC pauses**: Go's garbage collector runs regardless of which compiler is used, and a stop-the-world (or even concurrent-mark) pause mid-frame is a bad trade for an interactive, `requestAnimationFrame`-driven simulator — this is a structurally worse fit than C's manual/arena allocation for the tight, high-frequency step loop this engine runs.

**Where Go *does* make sense**: entirely server-side. If a batch/headless simulation service becomes a real need (bulk-verifying circuits, a faster backend for the fpgasim/mcusim integration tests, load-testing many golden fixtures at once), Go is a strong, boring choice there — fast to write, fast enough numerically, easy to containerize, and none of the WASM/GC-in-the-render-loop concerns apply because there's no render loop. That's a different project from "rewrite the browser engine," though — it wouldn't touch `web/app` at all.

## Recommendation, in order

1. **Port the sparse-solver threshold from Java** (`SimulationManager.java`'s `SOLVER_SPARSE` dispatch + `matrix/SparseLU.java`) into the TS engine. This is the actual performance gap this study surfaced, has a working reference implementation already in the repo, and closes the one regime (large nonlinear circuits) where the current dense-only TS engine measurably falls over. Effort: days, not months.
2. **If** large in-browser circuits become a real product goal, revisit a C→WASM engine core — using ngspice's WASM ports as a template for the JS↔WASM boundary — once feature parity (the 71 missing elements from the earlier functionality TODO) is closer to done. Rewriting a 44%-complete engine is worse than finishing it first.
3. **If** a headless/batch simulation need emerges independent of the browser UI, build that in Go (or C) as a standalone service — it's a much smaller, lower-risk project than touching the interactive engine, and Go's weaknesses here (GC pauses, WASM bloat) don't apply outside a render loop.
4. Don't rewrite the interactive browser engine in either language for raw speed alone — the benchmark shows there's no speed problem at the circuit sizes this tool actually sees.

Sources:
- [ngspiceX — Browser-Based SPICE Circuit Simulator](https://shishir-dey.github.io/ngspiceX/)
- [EEcircuit — a browser-based SPICE circuit simulator (GitHub)](https://github.com/eelab-dev/EEcircuit)
- [Nonspice — Browser SPICE Simulator](https://nonspice.com/)
- [ngspice: Add WebAssembly target (SourceForge patch)](https://sourceforge.net/p/ngspice/patches/96/)
- [TinyGo — Overview](https://tinygo.org/getting-started/overview/)
- [Why Your Go Binary Is Too Fat for WebAssembly (and How TinyGo Fixes It)](https://dev.to/alanwest/why-your-go-binary-is-too-fat-for-webassembly-and-how-tinygo-fixes-it-24l)
- [WebAssembly vs JavaScript Performance: Benchmarks, Speed Tests & Tips](https://medium.com/@hashbyt/webassembly-vs-javascript-performance-b2936d4c6c03)
- [Understanding the Performance of WebAssembly Applications](https://benchmarkingwasm.github.io/BenchmarkingWebAssembly/)
