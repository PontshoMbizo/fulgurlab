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
| `blocks[].id` | Unique, 1–64 chars of `[A-Za-z0-9_-]`. Scope results are keyed by this id. |
| `blocks[].type` | A type from `shared/catalog.js` (listed in [blocks.md](blocks.md)). |
| `blocks[].params` | Optional; missing keys take the catalogue default. Values are numbers, number arrays (polynomials, highest power first), or a sign string for Sum (`"+-"`) and Product (`"*/"`). |
| `x`, `y`, `name` | Editor-only, ignored by the server. |
| `links[].from/to` | `{ block, port }`, ports 0-based. An output may feed many inputs; each input takes exactly one wire. |

Limits (from `shared/catalog.js`):
- 200 blocks and 400 links;
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
