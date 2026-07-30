import { describe, it, expect } from "vitest";
import { alignedMaxTimeStep, MIN_STEPS_PER_QUANTUM } from "./timestepAlign";

// Steps per quantum, as an exact integer check rather than a float compare.
const steps = (quantumNs: number, dt: number) => (quantumNs * 1e-9) / dt;

describe("alignedMaxTimeStep", () => {
    it("returns null when there is nothing to align to", () => {
        expect(alignedMaxTimeStep([], 5e-6, 2000)).toBeNull();
        expect(alignedMaxTimeStep([0, -1, NaN], 5e-6, 2000)).toBeNull();
        expect(alignedMaxTimeStep([1e6], 0, 2000)).toBeNull();
    });

    it("divides the quantum a whole number of times", () => {
        const dt = alignedMaxTimeStep([1_000_000], 5e-5, 2000)!;
        expect(Number.isInteger(steps(1_000_000, dt))).toBe(true);
    });

    // The requested timestep is the resolution the analog circuit around the
    // chip needs; coarsening it to make a rendezvous cheaper would silently
    // damage accuracy. Alignment must only ever refine.
    it("never returns a timestep coarser than asked for, at sane settings", () => {
        for (const desired of [5e-6, 1e-5, 5e-5, 1e-4]) {
            const dt = alignedMaxTimeStep([1_000_000], desired, 2000)!;
            expect(dt).toBeLessThanOrEqual(desired * (1 + 1e-9));
        }
    });

    it("leaves the default 5 us timestep alone against a 1 ms quantum", () => {
        const dt = alignedMaxTimeStep([1_000_000], 5e-6, 2000)!;
        expect(steps(1_000_000, dt)).toBeCloseTo(200, 9);
    });

    // The cap is a guard against a ratio that would wedge a frame, and it is
    // the one case where the result IS coarser than requested.
    it("caps only at absurd ratios, and says so by coarsening", () => {
        const dt = alignedMaxTimeStep([100_000_000], 1e-6, 2000)!;   // would be 100k steps
        expect(steps(100_000_000, dt)).toBeCloseTo(2000, 9);
        expect(dt).toBeGreaterThan(1e-6);
    });

    it("enforces a floor of MIN_STEPS_PER_QUANTUM", () => {
        // A desired timestep far coarser than the whole quantum would ask for
        // a single step (or none); the floor keeps an interior point.
        const dt = alignedMaxTimeStep([1_000_000], 1, 2000)!;
        expect(steps(1_000_000, dt)).toBeCloseTo(MIN_STEPS_PER_QUANTUM, 9);
    });

    it("aligns to every chip via the GCD when quanta differ", () => {
        const quanta = [1_000_000, 250_000];     // gcd 250 us
        const dt = alignedMaxTimeStep(quanta, 5e-6, 2000)!;
        for (const q of quanta) expect(Number.isInteger(steps(q, dt))).toBe(true);
    });

    it("aligns to coprime quanta too", () => {
        const quanta = [300_000, 700_000];       // gcd 100 us
        const dt = alignedMaxTimeStep(quanta, 1e-5, 2000)!;
        for (const q of quanta) {
            expect(Number.isInteger(Math.round(steps(q, dt)))).toBe(true);
            expect(steps(q, dt)).toBeCloseTo(Math.round(steps(q, dt)), 9);
        }
    });

    it("keeps the cap sane even if the caller passes a silly one", () => {
        const dt = alignedMaxTimeStep([1_000_000], 5e-6, 0)!;
        expect(steps(1_000_000, dt)).toBeCloseTo(MIN_STEPS_PER_QUANTUM, 9);
    });
});
