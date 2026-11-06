# Architecture

## One simulation, end to end

1. The editor (`web/`) holds the diagram as a **netlist**: blocks with numeric
   parameters, wires between ports, plus stop time and scope sample step.
   [netlist.md](netlist.md) has the format.
2. `POST /api/simulate` sends it to the server. `server/src/netlist.js` validates
   it:
   - block types come from `shared/catalog.js`;
   - every parameter must be a finite number (or a +/- or */ string for Sum and
     Product);
   - every input must be wired, with no input wired twice;
   - transfer functions must be proper;
   - sample counts are capped.
3. `server/src/codegen.js` writes a Scilab script that builds an Xcos diagram
   (`scs_m`) from stock blocks and calls `scicos_simulate(scs_m, list(), "nw")`.
   Each Scope becomes a `TOWS_c` block (multi-input scopes get a `MUX` in front)
   with its own clock at the sample step. Fan-out gets explicit `SPLIT_f` blocks.
4. `server/src/runner.js` runs `scilab-cli -nb -quit -f model.sce` in a fresh temp
   directory, with a hard timeout and a concurrency cap. The script writes each
   scope to CSV and a `status` file; the runner parses both and returns
   `{ t, y[] }` per scope.
5. The editor plots each scope, with min/max decimation for long runs, a crosshair
   tooltip and CSV export.

A small diagram takes about 0.25–0.3 s per run, mostly Scilab start-up. One
million samples take about 2 s.

## Why parameters are set through `graphics.exprs`

`scicos_simulate` runs `do_eval`, which re-runs every block's own `set` function
from its `exprs`. That's the same thing that happens when you edit a block's
dialog in Xcos. So codegen only writes the dialog values (`["1"; "1+s"]` for a
transfer function), and Scilab computes `rpar`/`ipar`/states exactly as Xcos
would.

There are two exceptions:

- **Superblocks** (`CLOCK_c`, `STEP_FUNCTION`): their inner block (`EVTDLY_c`,
  `STEP`) is set directly.
- **Blocks with a variable number of inputs** (`SUMMATION`, `PRODUCT`, `MUX`):
  their ports are sized up front, because links are checked against ports as they
  are inserted, before `do_eval` would resize them.

## Security model

Scilab evaluates `exprs` as code, and the language can run shell commands
(`unix_g`, `host`). So:

- **Nothing user-typed reaches the script.**
  - Parameters are numbers formatted by `fmt()`.
  - Polynomials are built from those numbers.
  - Sum/Product signs are whitelisted characters mapped to `1`/`-1`.
  - Block ids and names never appear: codegen uses its own indices. A test checks
    this.
- The container (`compose.yml`) adds a second layer:
  - read-only root filesystem, with tmpfs for `/tmp`;
  - non-root user, all capabilities dropped, `no-new-privileges`;
  - pid, memory and CPU limits.
- Per-run timeout (default 20 s) with a process-group kill, plus a request body
  limit (512 KB).

Not done yet: per-client rate limiting and a network namespace for the Scilab
child. Put the server behind scope.io's API gateway, or add them before exposing
it publicly.

## Scilab quirks found while building this (Scilab 2024.0, Ubuntu package)

| Symptom | Cause / workaround |
|---|---|
| `scilab-cli` never exits | It waits on the console if stdin is open, even with `-quit`. The runner spawns it with stdin `'ignore'`. |
| `libsciscicos-cli.so: cannot open shared object` | The `scilab-cli` package doesn't include Xcos simulation. Install `scilab-full-bin` too. |
| `dpkg-architecture: not found`, then `cannot open shared object … libscifunctions.so` | Ubuntu's launcher calls `dpkg-architecture` (from `dpkg-dev`) to find its libraries. The image ships a one-file stand-in (`docker/dpkg-architecture`). On a desktop with build tools installed you already have the real one. |
| `scilab-cli` not found with only `scilab-full-bin` installed | It works the other way round as well: the `scilab-cli` launcher is its own package. Install both. |
| Exit code 255 on success | Normal. Success is read from the `status` file the script writes. |
| `messagebox function disabled in -nwni mode` hides the real error | Xcos reports compile errors (algebraic loops, port mismatches) through `messagebox`. The generated script shadows `messagebox` to capture the text. |
| Segfault, then the process hangs | After a fatal error Scilab can hang instead of exiting. That's what the hard timeout and process-group kill are for. |
| `scicosDiagramToScilab(file, scs_m)` segfaults for script-built diagrams | Avoid `.xcos` as an interchange format. The wire format is the JSON netlist and the server generates `scs_m` itself. |
| "No continuous-time state. Thresholds are ignored" | A warning (shown through `messagebox`) for purely discrete diagrams. Harmless. |

## Possible next steps

- **Scilab version pinning:** upstream is at 2026.1; Ubuntu ships 2024.0. Pin the
  image and keep the tests as the regression check before upgrading.
- **Faster runs:** keep a warm pool of Scilab processes driven through the C
  embedding API (`call_scilab.h`) instead of one process per run. This removes most
  of the ~0.25 s start-up.
- **Lockstep co-simulation:** compile once, then call `scicosim(state, t, t+q, sim,
  "run", tol)` per quantum, writing inputs into `sim.opar` and reading
  `state.outtb`. This was prototyped at 0.04 ms per quantum inside Scilab; the open
  problem is the IPC with a long-lived process.
- **More blocks:** state-space, signal generator, switch, MATLAB-style function
  (needs a safe expression whitelist), subsystems.
