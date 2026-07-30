import { describe, it, expect } from "vitest";
import { pacingDecision, type ChipPacingState } from "./cosimPacing";

const chip = (over: Partial<ChipPacingState> = {}): ChipPacingState => ({
    id: 1, steppedTNs: 0, quantumNs: 1_000_000, inflight: false, ...over,
});

describe("pacingDecision", () => {
    it("is free with no chips -- pure-analog circuits never pay for co-sim", () => {
        expect(pacingDecision(0, [])).toEqual({ kind: "free" });
        expect(pacingDecision(1e12, [])).toEqual({ kind: "free" });
    });

    it("is free while nothing is in flight, however far the clock has run", () => {
        expect(pacingDecision(5_000_000, [chip({ inflight: false })])).toEqual({ kind: "free" });
    });

    it("lets the circuit run freely INSIDE the in-flight quantum", () => {
        const c = chip({ inflight: true, steppedTNs: 0, quantumNs: 1_000_000 });
        expect(pacingDecision(0, [c])).toEqual({ kind: "free" });
        expect(pacingDecision(999_999, [c])).toEqual({ kind: "free" });
    });

    it("blocks exactly at the boundary of the in-flight quantum", () => {
        const c = chip({ inflight: true, steppedTNs: 0, quantumNs: 1_000_000 });
        expect(pacingDecision(1_000_000, [c])).toEqual({ kind: "wait", id: 1 });
        expect(pacingDecision(1_500_000, [c])).toEqual({ kind: "wait", id: 1 });
    });

    // The old code paused the WHOLE simulation on one chip's condition and
    // resumed it on any chip's reply, so with two chips the first reply
    // released the second chip's boundary too.
    it("reports the tighter of two chips with different quanta", () => {
        const slow = chip({ id: 1, quantumNs: 1_000_000, inflight: true });
        const fast = chip({ id: 2, quantumNs: 250_000, inflight: true });
        expect(pacingDecision(300_000, [slow, fast])).toEqual({ kind: "wait", id: 2 });
        // Once the fast one replies, the slow one still gates a later boundary.
        expect(pacingDecision(1_200_000, [slow, { ...fast, inflight: false }]))
            .toEqual({ kind: "wait", id: 1 });
    });

    // THE invariant. Boundaries are recomputed from the backend's own clock
    // after every reply, so a timestep that doesn't divide the quantum costs
    // at most one step of jitter per rendezvous and can never accumulate into
    // drift. Simulate a full run at a deliberately non-dividing timestep.
    it("does not accumulate drift over 1000 quanta at a non-dividing timestep", () => {
        const quantumNs = 1_000_000;
        const dtNs = 7_000;                 // 142.857... steps per quantum
        let t = 0;
        const c = chip({ quantumNs, inflight: false, steppedTNs: 0 });
        let completed = 0;

        for (let i = 0; i < 200_000 && completed < 1000; i++) {
            const d = pacingDecision(t, [c]);
            if (d.kind === "wait") {
                // Backend replies: its clock advances by exactly one quantum,
                // independent of where the circuit clock happens to sit.
                c.steppedTNs += quantumNs;
                c.inflight = false;
                completed++;
                continue;
            }
            if (!c.inflight && t >= c.steppedTNs) c.inflight = true;
            t += dtNs;
        }

        expect(completed).toBe(1000);
        expect(c.steppedTNs).toBe(1000 * quantumNs);
        // The circuit clock never runs more than a single timestep past the
        // backend's -- bounded, and NOT growing with the number of quanta.
        expect(t - c.steppedTNs).toBeLessThan(dtNs);
        expect(t - c.steppedTNs).toBeGreaterThanOrEqual(0);
    });
});
