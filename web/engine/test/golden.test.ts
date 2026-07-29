// GOLDEN TRACES (audit issue #6, the numerical-parity gate from plan §6):
// node-voltage traces recorded from the REAL GWT/Java build (driven live in
// Chrome via its JS API: importCircuit -> run briefly to force analysis ->
// reset -> stepSim(1) x N -> read probes) compared pointwise against this
// engine running the exact same circuit text.
//
// Protocol notes (mirror tools/golden-recorder/record.mjs):
//  - The oracle analyzes a circuit inside its animation frame loop, so the
//    recorder runs it for a moment and then calls reset() to return to t=0
//    with the analysis retained. Both sides therefore start from a genuine
//    t=0, and `warmupSteps` means the same number of real steps on each.
//  - sampling "after-step": sample i is taken right AFTER step (warmup+i+1).
//  - Tolerances are per-fixture (linear tighter than nonlinear; Newton
//    iteration ordering differs legitimately in floating point).
//  - PROBE FORMS: "node:<label>" reads a LabeledNodeElm by name;
//    "elm:<i>:<p>" reads post p of the i'th element line. Index probes need no
//    coordinate arithmetic, so they are the safer way to author a fixture --
//    and both engines build their element list in dump order, which this gate
//    is itself a check on.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CircuitEngine } from "../src/core/engine";
import { CircuitParser } from "../src/core/parser";

interface GoldenFixture {
    name: string; dt: number; warmupSteps: number; steps: number;
    rtol: number; atol: number; circuit: string; note?: string;
    // Multi-probe form (current recorder).
    probes?: Record<string, number[]>;
    // Single-probe mirror, kept for fixtures recorded before multi-probe
    // support. When `probes` is present these just duplicate its first entry.
    probe?: string; trace?: number[];
}

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "fixtures");

function fixtures(): GoldenFixture[] {
    return readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
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

// Resolves a probe spec against this engine, mirroring record.mjs's `read()`.
function readProbe(engine: CircuitEngine, spec: string): number {
    if (spec.startsWith("elm:")) {
        const [, i, post] = spec.split(":");
        const elm = engine.elmList[parseInt(i, 10)];
        if (!elm) throw new Error(`probe ${spec}: no element at index ${i} (elmList has ${engine.elmList.length})`);
        const v = elm.volts[parseInt(post, 10)];
        if (v === undefined) throw new Error(`probe ${spec}: element has no post ${post}`);
        return v;
    }
    return labeledVoltage(engine, spec.replace(/^node:/, ""));
}

function probeMap(fx: GoldenFixture): Record<string, number[]> {
    if (fx.probes) return fx.probes;
    if (fx.probe && fx.trace) return { [fx.probe]: fx.trace };
    throw new Error(`${fx.name}: fixture has neither probes{} nor probe/trace`);
}

describe("golden traces vs the GWT/Java oracle", () => {
    const all = fixtures();

    it("the gate is not empty and covers more than one probe per fixture somewhere", () => {
        expect(all.length).toBeGreaterThanOrEqual(11);
        const multi = all.filter((fx) => Object.keys(probeMap(fx)).length > 1);
        expect(multi.length).toBeGreaterThanOrEqual(5);
    });

    for (const fx of all) {
        const probes = probeMap(fx);
        const names = Object.keys(probes);
        it(`${fx.name}: matches the oracle on ${names.length} probe(s) over ${fx.steps} steps (rtol ${fx.rtol})`, () => {
            const engine = new CircuitEngine();
            new CircuitParser(engine).parse(fx.circuit);
            expect(engine.timeStep).toBeCloseTo(fx.dt, 12);

            for (const [spec, trace] of Object.entries(probes)) {
                expect(trace.length).toBe(fx.steps);
            }

            for (let i = 0; i < fx.warmupSteps; i++) engine.stepOnce();

            for (let i = 0; i < fx.steps; i++) {
                engine.stepOnce();
                for (const spec of names) {
                    const got = readProbe(engine, spec);
                    const want = probes[spec][i];
                    const tol = fx.atol + fx.rtol * Math.max(Math.abs(got), Math.abs(want));
                    if (Math.abs(got - want) > tol) {
                        const t = ((fx.warmupSteps + i + 1) * fx.dt * 1e6).toFixed(1);
                        throw new Error(
                            `${fx.name} [${spec}]: diverged at sample ${i} (t=${t}µs): ` +
                            `engine=${got} oracle=${want} ` +
                            `|Δ|=${Math.abs(got - want).toExponential(3)} > ${tol.toExponential(3)}`,
                        );
                    }
                }
            }
        });
    }
});
