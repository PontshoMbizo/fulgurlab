# Netlist format and HTTP API

## Netlist (diagram JSON)

This is the format the editor saves (`*.fulgur.json`) and the server simulates.

```json
{
  "version": 1,
  "name": "First-order step response",
  "settings": { "tf": 5, "dt": 0.01 },
  "blocks": [
    { "id": "step",  "type": "step",       "params": { "time": 0 },                     "x": 60,  "y": 120, "name": "Step" },
    { "id": "plant", "type": "transferFn", "params": { "num": [1], "den": [1, 1] },     "x": 260, "y": 120, "name": "Plant" },
    { "id": "scope", "type": "scope",      "params": { "inputs": 1 },                   "x": 480, "y": 120, "name": "Response" }
  ],
  "links": [
    { "from": { "block": "step",  "port": 0 }, "to": { "block": "plant", "port": 0 } },
    { "from": { "block": "plant", "port": 0 }, "to": { "block": "scope", "port": 0 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `settings.tf` | Stop time in seconds, `(0, 10000]`. Default 10. |
| `settings.dt` | Scope sample step in seconds. The solver picks its own internal steps. Default 0.01. |
| `blocks[].id` | Unique within its diagram, 1–64 chars of `[A-Za-z0-9_-]`. Scope results are keyed by this id, or by the id path for a scope inside a subsystem (`fwd/scope`). |
| `blocks[].type` | A type from `shared/catalog.js` (listed in [blocks.md](blocks.md)). |
| `blocks[].params` | Optional; missing keys take the catalogue default. Values are numbers, number arrays (polynomials, highest power first), arrays of rows (`matrix`, state-space), an expression string (`expr`, User Function), or a sign string for Sum (`"+-"`) and Product (`"*/"`). |
| `blocks[].system` | Only on `subsystem` blocks: a nested `{ blocks, links }` diagram. See below. |
| `x`, `y`, `name` | Editor-only, ignored by the server. |
| `links[].from/to` | `{ block, port }`, ports 0-based. An output may feed many inputs; each input takes exactly one wire. |

## Subsystems

A `subsystem` block holds a whole diagram in `system`. Its ports are the `inport` and `outport` blocks inside it: input k of the subsystem is its k-th Inport ordered by the `index` parameter (indices must be unique, gaps are fine), and output k is its k-th Outport. Inport and Outport blocks are only valid inside a subsystem. Ids only need to be unique within one diagram. The server flattens subsystems before simulating, so a nested diagram gives exactly the same trace as the equivalent flat one. Problems inside a subsystem are reported with the id path of the block (`fwd/pid`).

```json
{ "id": "fwd", "type": "subsystem", "system": {
    "blocks": [ { "id": "in", "type": "inport" }, { "id": "g", "type": "gain" }, { "id": "out", "type": "outport" } ],
    "links":  [ { "from": { "block": "in", "port": 0 }, "to": { "block": "g", "port": 0 } },
                { "from": { "block": "g", "port": 0 },  "to": { "block": "out", "port": 0 } } ] } }
```

Limits (from `shared/catalog.js`):
- 200 blocks and 400 links, counted across all levels together;
- subsystems nested at most 4 deep;
- 16 coefficients per polynomial;
- 1,000,000 samples per scope and 2,000,000 in total.

## HTTP API

### `POST /api/simulate`

Body: a netlist. The responses:

```jsonc
// 200
{ "ok": true, "elapsedMs": 281,
  "scopes": { "scope": { "t": [0, 0.01, ...], "y": [[0, 0.00995, ...]] } } }
//                                         one array per scope input ^

// 422 – the diagram is invalid (nothing was run)
{ "ok": false, "error": "The diagram has problems",
  "issues": [{ "path": "blocks", "message": "input 1 of Gain \"g\" is not connected", "block": "g" }] }

// 422 – Scilab refused or failed
{ "ok": false, "error": "Algebraic loop: a feedback path has no integrator, delay or transfer function with dynamics in it.",
  "log": "…Scilab console tail…" }
```

### `POST /api/validate`

Same checks as `simulate` without running Scilab. Returns `{ ok, issues }`, always
with status 200.

### `GET /api/health`

Returns `{ "ok": true, "scilab": "2024.0.0", "concurrency": 2 }`. `ok` is false
when Scilab can't be started.

### Server environment

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `SCILAB_BIN` | `scilab-cli` | Path to Scilab's CLI binary. |
| `SIM_TIMEOUT_MS` | `20000` | Hard limit per run. |
| `SIM_CONCURRENCY` | CPUs − 1 | Runs at once; extra requests queue. |
| `SIM_WORKDIR` | OS temp | Where per-run directories go. |
| `SIM_KEEP_WORK` | unset | `1` keeps generated scripts for debugging. |
| `CORS_ORIGINS` | none | Comma-separated origins (or `*`) allowed to call the API from a browser. |
| `STATIC_DIR` | `web/dist` | Built editor served at `/`. |
