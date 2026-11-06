# fulgurlab

<p align="center">
  <img src="web/public/favicon.svg" alt="fulgurlab logo" width="72" height="72">
  <br>
  <em>A basic Simulink-style block diagram simulator for the browser, built for scope.io</em>
</p>

Draw a block diagram in the browser and press **Run**. The diagram goes to a small
server that turns it into an Xcos model and simulates it with **headless Scilab**.
The traces from every Scope block come back and are plotted.

There's no simulation code in the browser: Scilab (its Xcos/scicos engine and
LSODAR/CVODE solvers) is the only engine. That keeps the results authoritative,
which is what scope.io needs for checking answers.

```
browser (web/)                          server (server/)                      Scilab
┌──────────────────────────────┐  JSON  ┌──────────────────────────────┐ .sce ┌──────────────────┐
│ palette · canvas · inspector │ ─────► │ validate → generate script → │ ───► │ scilab-cli -nb   │
│ scope plots (SVG)            │ ◄───── │ run (timeout, sandbox) → CSV │ ◄─── │ scicos_simulate  │
└──────────────────────────────┘ traces └──────────────────────────────┘      └──────────────────┘
```

## Quick start

You need Node 20+ and Scilab with the Xcos simulation library. On Ubuntu/Debian:

```bash
sudo apt install --no-install-recommends scilab-cli scilab-full-bin   # launcher + Xcos simulation
npm --prefix web install

npm run dev:server        # API on :8080
npm run dev:web           # editor on http://localhost:5173 (proxies /api to :8080)
```

Or run everything in one container (no local Scilab needed):

```bash
docker compose up --build   # http://localhost:8080
```

**Fedora (no Scilab package; it was retired) or anywhere without apt:** run the
server in a container with Podman and develop the editor on the host:

```bash
podman build --format docker -t fulgurlab .      # docker format keeps the HEALTHCHECK
podman run --rm -p 8080:8080 --read-only --tmpfs /tmp --tmpfs /home/fulgur \
  --cap-drop=ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g fulgurlab
npm run dev:web                                    # editor on :5173, /api proxied to :8080
podman run --rm fulgurlab sh -c "cd server && node --test test/*.test.js"   # full test suite
```

Tests run real simulations against analytic answers; they're skipped if Scilab isn't installed:

```bash
npm test
```

## Blocks

| Category | Blocks |
|---|---|
| Sources | Step, Constant, Sine Wave, Ramp, Clock (time) |
| Math | Gain, Sum, Product, Abs, Saturation |
| Continuous | Integrator, Derivative, Transfer Fcn, PID Controller, Transport Delay |
| Discrete | Zero-Order Hold, Unit Delay, Discrete TF |
| Sinks | Scope (1–8 inputs) |

Each block maps onto stock Xcos blocks; see [docs/blocks.md](docs/blocks.md).
To add a block, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Using it in scope.io

- **iframe:** load `/?embed=1`, then send it a diagram and listen for results with
  `postMessage`.
- **React component:** `import { FulgurEditor } from 'web/src'`.
- **HTTP only:** `POST /api/simulate` with a netlist and grade the traces on your
  side.

[docs/embedding.md](docs/embedding.md) covers all three.

## Layout

```
shared/catalog.js     block catalogue (ports, parameters), used by both web and server
server/               HTTP API: netlist validation, Scilab code generation, sandboxed runner
  src/netlist.js        validation: whitelisted blocks, numbers only, wiring rules, limits
  src/codegen.js        netlist -> Scilab script that builds scs_m and runs scicos_simulate
  src/runner.js         spawns scilab-cli (stdin closed, hard timeout, concurrency cap)
  test/                 unit tests + real-Scilab tests against analytic results
web/                  React + Vite editor (canvas, palette, inspector, scope charts)
examples/             sample diagrams (also used by the tests and the Examples menu)
docs/                 architecture, netlist format, blocks, embedding
```

## Docs

- [docs/architecture.md](docs/architecture.md): how a run works, plus the Scilab quirks found while building it
- [docs/netlist.md](docs/netlist.md): the diagram JSON and the HTTP API
- [docs/blocks.md](docs/blocks.md): how each block maps onto Xcos
- [docs/embedding.md](docs/embedding.md): iframe, React and API integration
