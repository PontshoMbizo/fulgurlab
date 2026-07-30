// Pacing decision for the co-simulation run loop -- extracted from
// engine/store.ts's loop so the rule can be tested directly (the app's vitest
// setup covers .ts only; components and the rAF loop itself are out of scope,
// same split as scope/Scope.tsx -> scope/scopeUi.ts).
//
// THE RULE. A co-simulated chip and the circuit solver rendezvous once per
// quantum. The circuit clock may not advance past a quantum boundary whose
// step is still in flight, because the outputs that step will return are the
// ones the circuit is supposed to see on the far side of that boundary.
// Stepping anyway would silently re-use the previous quantum's outputs and
// quietly desynchronise the two solvers.
//
// This replaces the old behaviour, where the client's own onSimTime() paused
// the WHOLE SIMULATION via cancelAnimationFrame once a chip fell a full
// quantum behind, and any single chip's reply resumed it -- a per-chip
// condition driving a global control. With two chips the first reply resumed
// the sim while the second was still outstanding. Here every blocked chip is
// waited on in turn.

export interface ChipPacingState {
    id: number;
    /** Backend clock after the last completed step, ns. */
    steppedTNs: number;
    quantumNs: number;
    inflight: boolean;
}

export type PacingDecision =
    | { kind: "free" }
    | { kind: "wait"; id: number };

/**
 * Given the circuit clock (ns) and the live chips, decide whether the engine
 * may take another step. Returns the FIRST chip that blocks; callers re-run
 * this after each wait, so several blockers are handled in turn.
 *
 * With no chips this is `free` unconditionally -- pure-analog circuits never
 * pay for co-simulation.
 */
export function pacingDecision(tNs: number, chips: ChipPacingState[]): PacingDecision {
    for (const c of chips) {
        if (!c.inflight) continue;
        // The in-flight step covers [steppedTNs, steppedTNs + quantumNs]. The
        // circuit may run freely inside that window; it may not leave it.
        if (tNs >= c.steppedTNs + c.quantumNs) return { kind: "wait", id: c.id };
    }
    return { kind: "free" };
}
