// GOLDEN TRACES (audit issue #6, the numerical-parity gate from plan §6):
// node-voltage traces recorded from the REAL GWT/Java build (driven live in
// Chrome via its JS API: importCircuit -> stepSim(1) x N -> getNodeVoltage,
// deterministic stepping, fixed dt) compared pointwise against this engine
// running the exact same circuit text.
//
// Protocol notes (mirror tools/golden-recorder/record.mjs):
//  - warmupSteps: the oracle analyzes circuits inside its frame loop, so a
//    few frames ran before recording started; both engines step this many
//    times from t=0 before the compared window begins. Same dt throughout,
//    so both sides are at the identical simulation time for sample 0.
//  - sampling "after-step": sample i is taken right AFTER step (warmup+i+1).
//  - Tolerances are per-fixture (linear tighter than nonlinear; Newton
//    iteration ordering differs legitimately in floating point).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CircuitEngine } from "../src/core/engine";
import { CircuitParser } from "../src/core/parser";

interface GoldenFixture {
    name: string; dt: number; warmupSteps: number; steps: number;
    probe: string; rtol: number; atol: number; circuit: string; trace: number[];
}

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "fixtures");

function fixtures(): GoldenFixture[] {
    return readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as GoldenFixture);
}

function labeledVoltage(engine: CircuitEngine, label: string): number {
    for (const elm of engine.elmList) {
        if (String(elm.getDumpType()) === "207" &&
            (elm as unknown as { text: string }).text === label) {
            return elm.volts[0];
        }
    }
    throw new Error(`labeled node "${label}" not found`);
}

describe("golden traces vs the GWT/Java oracle", () => {
    for (const fx of fixtures()) {
        it(`${fx.name}: matches the oracle over ${fx.steps} steps (rtol ${fx.rtol})`, () => {
            const engine = new CircuitEngine();
            new CircuitParser(engine).parse(fx.circuit);
            expect(engine.timeStep).toBeCloseTo(fx.dt, 12);

            for (let i = 0; i < fx.warmupSteps; i++) engine.stepOnce();

            for (let i = 0; i < fx.steps; i++) {
                engine.stepOnce();
                const got = labeledVoltage(engine, fx.probe);
                const want = fx.trace[i];
                const tol = fx.atol + fx.rtol * Math.max(Math.abs(got), Math.abs(want));
                if (Math.abs(got - want) > tol) {
                    const t = ((fx.warmupSteps + i + 1) * fx.dt * 1e6).toFixed(1);
                    throw new Error(
                        `${fx.name}: diverged at sample ${i} (t=${t}µs): ` +
                        `engine=${got} oracle=${want} |Δ|=${Math.abs(got - want).toExponential(3)} > ${tol.toExponential(3)}`,
                    );
                }
            }
        });
    }
});
