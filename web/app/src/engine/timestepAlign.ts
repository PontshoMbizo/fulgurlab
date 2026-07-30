// Choosing the engine timestep when co-simulated chips are present.
//
// WHY. A quantum boundary is where the two solvers exchange state. If the
// timestep does not divide the quantum, boundaries land mid-step and the
// exchange happens up to one timestep late. That error is JITTER, NOT DRIFT --
// the client recomputes `due = steppedTNs + quantumNs` from the backend's own
// clock after every reply, so it can never accumulate -- but it is free to
// remove, so remove it.
//
// The bigger reason to be here at all is cost. The engine defaults to a 5 us
// timestep; against a 1 ms quantum that is 200 solver steps per rendezvous,
// and the chip's outputs are constant across every one of them (the co-sim
// contract is a zero-order hold, see docs/bridge-protocol.md). Those steps buy
// resolution only for the analog circuit around the chip, so for a typical
// LED/resistor load nearly all of them are wasted. Dividing the quantum into a
// handful of steps instead is the difference between roughly 800x slower than
// real time and roughly real time.
//
// This deliberately lives in the app, not in CircuitEngine: the engine's own
// timestep is fixture-pinned by the golden traces (each fixture's `$` line
// sets it and golden.test.ts asserts it), and those construct a bare
// CircuitEngine that never reaches this code. Alignment applies only when
// chips are actually present.

/**
 * Fewest steps we will ever run per quantum. Two rather than one so the
 * circuit still has an interior point to converge on within a quantum, and so
 * a degenerate `quantum < timeStep` cannot drive the step count to zero.
 */
export const MIN_STEPS_PER_QUANTUM = 2;

function gcd(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return a;
}

/**
 * Largest timestep (seconds) that is no coarser than `desiredMaxTimeStep` and
 * divides EVERY chip's quantum a whole number of times.
 *
 * Chips with different quanta are handled through the integer GCD of the quanta
 * in ns, which is exactly the coarsest grid every boundary lands on.
 *
 * `maxStepsPerQuantum` is a LAST-RESORT GUARD, not a tuning knob. It exists so
 * an absurd ratio (a 100 ms quantum against a 1 us timestep is 100,000 solver
 * steps per rendezvous) cannot wedge a frame. It should not bind in normal use,
 * because when it does bind it returns a timestep COARSER than requested --
 * and the requested timestep is the resolution the analog circuit around the
 * chip actually needs. Silently decimating an RC network's accuracy to make a
 * rendezvous cheaper is the wrong trade: the expensive part of co-simulation is
 * the backend (see clock_hz in docs/bridge-protocol.md), not the solver.
 *
 * Returns null when there is nothing to align to (no chips, or nonsense input),
 * meaning "leave the engine's timestep alone".
 */
export function alignedMaxTimeStep(
    quantaNs: number[],
    desiredMaxTimeStep: number,
    maxStepsPerQuantum: number,
): number | null {
    const valid = quantaNs.filter((q) => Number.isFinite(q) && q > 0).map((q) => Math.round(q));
    if (valid.length === 0) return null;
    if (!Number.isFinite(desiredMaxTimeStep) || desiredMaxTimeStep <= 0) return null;

    const base = valid.reduce(gcd);
    const baseSeconds = base * 1e-9;

    const cap = Math.max(MIN_STEPS_PER_QUANTUM, Math.floor(maxStepsPerQuantum));
    // Steps needed to get at or below the desired timestep, then clamped. The
    // result divides `base` exactly, and `base` divides every quantum, so the
    // timestep divides every quantum.
    const wanted = Math.ceil(baseSeconds / desiredMaxTimeStep);
    const steps = Math.min(Math.max(wanted, MIN_STEPS_PER_QUANTUM), cap);
    return baseSeconds / steps;
}
