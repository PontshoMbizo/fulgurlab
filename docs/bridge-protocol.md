# fulgurlab bridge protocol v1

Lockstep co-simulation contract between **fulgurlab** (the circuitjs1-based analog/digital
canvas) and external HDL/firmware simulators: **fpgasim** (Verilog → iverilog/vvp) and
**mcusim** (bare-metal C → arm-none-eabi-gcc → QEMU). One protocol, two backends.

```
┌────────────── browser ──────────────┐        ┌───────── backend (per sim) ─────────┐
│ circuitjs canvas                    │        │ bridge server (Node, ws)            │
│  └─ ExtChipElm (Java/GWT)           │  WS    │  └─ session ⇄ hardened container    │
│      ⇅ sync JSNI call per timestep  │ ◄────► │      stdio line protocol            │
│ FulgurBridge (JS client, war/)      │  JSON  │      (vvp harness / QEMU firmware)  │
└─────────────────────────────────────┘        └─────────────────────────────────────┘
```

## Lockstep model

Time advances in **quanta** (`quantum_ns`, default 1 000 000 = 1 ms). Per quantum:

1. Client samples the chip's input pins from circuit node voltages (≥ Vth ⇒ 1).
2. Client sends `step` with those levels; the backend advances its simulator **exactly**
   `quantum_ns` of virtual time with those inputs held.
3. Backend replies `stepped` with output pin levels at the quantum boundary (plus
   intra-quantum edges for scope display).
4. Client drives its output pins with those levels for the whole next quantum.

Hard rules:

- At most **one `step` in flight** per session. The client must not send `step` N+1
  before `stepped` N. If the reply is late, the client pauses the circuit clock
  (`CircuitJS1.setSimRunning(false)`) — skew is bounded at one quantum by construction.
- Inputs take effect at the start of the quantum; outputs are valid at its end.
  Signal changes faster than the quantum are invisible across the bridge (choose
  `quantum_ns` accordingly).
- `t_ns` in `step` is the circuit-side clock, used only for drift detection: the backend
  answers with its own accumulated `t_ns` and both should track within one quantum.

## WebSocket messages (JSON text frames)

Client → server:

| type | fields | meaning |
|---|---|---|
| `hello` | `proto:1, client` | version handshake, first frame |
| `create` | `source, config{quantum_ns?, top?, engine?, pins?}` | compile & start a session |
| `step` | `session, t_ns, inputs:{PIN:0\|1}` | advance one quantum |
| `reset` | `session` | restart the same build from t = 0 |
| `dispose` | `session` | kill the session/container |

Server → client:

| type | fields | meaning |
|---|---|---|
| `welcome` | `proto:1, backend:"fpgasim"\|"mcusim", version` | handshake reply |
| `created` | `session, pins:[{name, dir:"in"\|"out"}], quantum_ns` | session ready |
| `stepped` | `session, t_ns, outputs:{PIN:0\|1}, events:[[t_ns,PIN,v],…]` | quantum done |
| `reset_done` | `session` | after `reset` |
| `ended` | `session, reason` | sim finished (`$finish` / SYS_EXIT) — outputs freeze |
| `disposed` | `session` | after `dispose` |
| `error` | `session?, stage:"proto"\|"compile"\|"runtime"\|"timeout", log` | failure; session dead unless `stage:"proto"` |

`events` carry intra-quantum **output** edges (backend-side timestamps) for waveform
display only; the circuit solver applies boundary values only.

Pin naming: fpgasim uses the top module's port names; mcusim uses the trace signal names
(`PC13`, …). `config.pins` lets the client restrict/order the exposed pins; otherwise the
backend exposes what it discovers (fpgasim: parsed ANSI header; mcusim: declared
`LOCKSTEP_PINS` in the firmware, see below).

## Container line protocol (backend ⇄ sandbox)

The bridge server never runs untrusted code itself. It spawns the **same hardened
container** as batch mode (network none, read-only FS, tmpfs /work, cap-drop ALL,
pids/mem/cpu caps, non-root) in *session mode*, and relays quanta over stdio:

- First stdin line: `##SRC <bytes>` then exactly that many source bytes; the remainder of
  stdin is the quantum stream.
- Quantum request (stdin): `T <quantum_ns> <in_hex>`
- Edge event (stdout): `E <t_ns> <pin_index> <0|1>`
- Quantum reply (stdout): `O <t_ns> <out_hex>` (terminates the quantum's output)
- End (stdout): `X <reason>`
- Pin order for the hex bitvectors = the `created.pins` array order, LSB = index 0.

Session limits (server-enforced on top of container caps): idle timeout 60 s without a
`step`, hard wall cap 10 min, per-reply timeout 5 s ⇒ kill + `error stage:"timeout"`.

## Backend specifics

**fpgasim** — a generated *lockstep harness* (pure Verilog, no VPI) instantiates the
user's top module: `$fscanf(stdin)` reads `T` lines, applies inputs, `#quantum` advances,
`always @(outs)` emits `E` lines, then emits `O` and loops. Same iverilog/vvp, same image.
Internal clocks (e.g. 27 MHz `clk`) are generated inside the harness as in batch mode.

**mcusim** — host-side codegen appends *lockstep glue* to the user's C: strong
`__trace_pin_hook` (records output-pin changes → `E`), strong `__trace_read_hook`
(serves input pins from a shadow word), and a strong `SysTick_Handler` that fires once
per quantum (reload = quantum_ns × 72 cycles/µs ÷ 1000, 24-bit ⇒ quantum ≤ 233 ms),
emitting `O` and blocking on a semihosting `SYS_READC` loop until the next `T` line —
QEMU's vCPU stalls inside the semihosting call, which *is* the lockstep. Firmware
declares its pins with `LOCKSTEP_PINS("PC13:out", "PA0:in")` (macro in trace.h glue).
Virtual time = SysTick tick count × quantum; sub-quantum instruction timing is
approximate (icount) — good for GPIO-rate signals, not bit-banged fast buses.

## circuitjs side

`ExtChipElm` (extends `ChipElm`, dump type 420 / xml `extchip`): pins from the session's
`created.pins`; per `doStep()` it reads input node voltages and asks the global
`window.FulgurBridge` (war/fulgur-bridge.js) for the current output levels — a
synchronous, non-blocking JS call. FulgurBridge owns the async ws exchange, quantum
pacing, and pausing/resuming the sim on backpressure or reconnect. Electrical model:
3.3 V push-pull outputs (configurable), Vth = 1.65 V input threshold.

## Versioning

`proto` is a single integer. Backends reject unknown majors with `error stage:"proto"`.
Additive fields are allowed without a bump; semantic changes bump it.
