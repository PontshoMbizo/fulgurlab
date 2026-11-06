# Blocks and their Xcos mapping

Every editor block is lowered to stock Xcos blocks by `server/src/codegen.js`.
Parameter values go into the Xcos block's dialog values (`graphics.exprs`), and
Scilab rebuilds the block from them as it does in Xcos.

| Block (`type`) | Parameters | Xcos blocks | Notes |
|---|---|---|---|
| Step (`step`) | time, initial, final | `STEP_FUNCTION` | Inner `STEP` set directly (superblock). |
| Constant (`constant`) | value | `CONST_m` | |
| Sine Wave (`sine`) | amplitude, frequency (rad/s), phase (rad) | `GENSIN_f` | |
| Ramp (`ramp`) | slope, start, initial | `RAMP` | |
| Clock (`clock`) | none | `TIME_f` | Outputs t. |
| Gain (`gain`) | k | `GAINBLK` | |
| Sum (`sum`) | signs, e.g. `"+-"` | `SUMMATION` | One input per sign. |
| Product (`product`) | ops, e.g. `"*/"` | `PRODUCT` | `/` divides by that input. |
| Abs (`abs`) | none | `ABS_VALUE` | |
| Saturation (`saturation`) | upper, lower | `SATURATION` | Zero-crossing detection on. |
| Integrator (`integrator`) | x0 | `INTEGRAL_m` | |
| Derivative (`derivative`) | none | `DERIV` | |
| Transfer Fcn (`transferFn`) | num, den (highest power first) | `CLR` | Must be proper. |
| PID Controller (`pid`) | kp, ki, kd, n | `CLR` (or `GAINBLK` for P only) | Parallel form Kp + Ki/s + Kd·N·s/(s+N), written as one transfer function. |
| Transport Delay (`delay`) | T, initial | `TIME_DELAY` | Buffer 1024. |
| Zero-Order Hold (`zoh`) | ts | `SAMPHOLD_m` + `CLOCK_c` | Each discrete block gets its own clock. |
| Unit Delay (`unitDelay`) | ts, x0 | `DOLLAR_m` + `CLOCK_c` | |
| Discrete TF (`discreteTF`) | num, den, ts | `DLR` + `CLOCK_c` | |
| Scope (`scope`) | inputs (1–8) | `TOWS_c` (+ `MUX`) + `CLOCK_c` | Samples every `settings.dt`; results keyed by block id. |

Wiring helpers that codegen inserts on its own: `SPLIT_f` for one output feeding
several inputs, `MUX` in front of multi-input scopes, and a `CLOCK_c` per discrete
block and per scope.

`server/test/simulate.test.js` checks every block against an analytic value through
real Scilab.
