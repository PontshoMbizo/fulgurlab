import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CircuitEngine } from '../src/core/engine';
import { CircuitParser } from '../src/core/parser';
import { LogicInputElm } from '../src/elements/logic_in_out';
import {
    CustomLogicElm,
    getModelWithName,
    undumpModelFromTokens,
    dumpCustomLogicModels,
} from '../src/elements/custom_logic';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('CustomLogicModel registry ("!" line parsing)', () => {
    it('parses a real "!" line out of tests/custom.txt (the "comparator" model)', () => {
        const text = readFileSync(path.join(ROOT, 'tests', 'custom.txt'), 'utf8');
        const line = text.split('\n').find(l => l.startsWith('! comparator'));
        expect(line).toBeTruthy();
        const tokens = line!.trim().split(/\s+/);
        expect(tokens[0]).toBe('!');

        undumpModelFromTokens(tokens.slice(1));
        const model = getModelWithName('comparator');

        expect(model.inputs).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        expect(model.outputs).toEqual(['E', '>', '<']);
        expect(model.infoText).toBe('comparator');
        // 5 rule lines in that model's rule table (see the file's escaped
        // rules field: "ABC=ABC", "1??=0??", "A1?=A0?", "AB1=AB0", "???=???").
        expect(model.rulesLeft.length).toBe(5);
        expect(model.rulesRight.length).toBe(5);
    });

    it('dumpCustomLogicModels() round-trips a registered model back to an equivalent "!" line', () => {
        undumpModelFromTokens(['roundtrip', '0', 'X,Y', 'Z', 'rt-info', '11\\q1\\n??\\q0\\n']);
        const lines = dumpCustomLogicModels(['roundtrip']);
        expect(lines.length).toBe(1);
        expect(lines[0].startsWith('! roundtrip 0 X,Y Z rt-info ')).toBe(true);

        // Feed the dumped line back through undumpModelFromTokens (simulating
        // a reload) and check the parsed rule table matches.
        const reparsedTokens = lines[0].trim().split(/\s+/).slice(1);
        undumpModelFromTokens(reparsedTokens);
        const model = getModelWithName('roundtrip');
        expect(model.rulesLeft).toEqual(['11', '??']);
        expect(model.rulesRight).toEqual(['1', '0']);
    });
});

describe('CustomLogicElm rules engine', () => {
    it('a 2-input AND built entirely from rules ("11=1", "??=0") matches a real AND truth table', () => {
        undumpModelFromTokens(['and-rules', '0', 'A,B', 'C', 'and-rules', '11\\q1\\n??\\q0\\n']);

        function runCase(a: string, b: string): number {
            const engine = new CircuitEngine();
            const elm = new CustomLogicElm(0, 0, 100, 0, 0, ['and-rules']);
            elm.preStamp();
            const inA = elm.getPost(0)!, inB = elm.getPost(1)!;

            const hiA = new LogicInputElm(inA.x, inA.y, inA.x, inA.y, 0, [a]);
            const hiB = new LogicInputElm(inB.x, inB.y, inB.x, inB.y, 0, [b]);

            engine.elmList = [elm, hiA, hiB];
            engine.analyzeAndStamp();
            for (let i = 0; i < 5; i++) engine.stepOnce();
            return elm.volts[2];
        }

        expect(runCase('0', '0')).toBeLessThan(2.5);
        expect(runCase('1', '0')).toBeLessThan(2.5);
        expect(runCase('0', '1')).toBeLessThan(2.5);
        expect(runCase('1', '1')).toBeGreaterThan(2.5);
    });

    it('an edge-triggered ("+") rule only fires on the rising edge, then holds', () => {
        // Single rule: "+" (T rises) => output forced to 1. No other rule, so
        // a non-match (T steady or falling) leaves the output exactly as it
        // was -- this is execute()'s real "no rule matched -> no change"
        // fallthrough (CustomLogicElm.java:190-191/205-211), not a special
        // case added for this test.
        undumpModelFromTokens(['edge-set', '0', 'T', 'Q', 'edge-set', '+\\q1\\n']);

        const engine = new CircuitEngine();
        const elm = new CustomLogicElm(0, 0, 100, 0, 0, ['edge-set']);
        elm.preStamp();
        const inT = elm.getPost(0)!;
        const hiT = new LogicInputElm(inT.x, inT.y, inT.x, inT.y, 0, ['0']);

        engine.elmList = [elm, hiT];
        engine.analyzeAndStamp();

        // Step 1: T low, from an initial lastValues of all-false -> no rising
        // edge (false && !false === false) -> rule doesn't match -> Q stays
        // at its initial false/0V.
        engine.stepOnce();
        expect(elm.volts[1]).toBeLessThan(2.5);

        // Flip T high. NOTE: elm.doStep() reads its OWN cached `this.volts[0]`
        // (populated from the PREVIOUS fully-solved step), and elmList order
        // is [elm, hiT] -- so the step immediately after flipping `position`
        // still sees the OLD (low) voltage; the rising edge only becomes
        // visible to execute() the step AFTER that, once the solved 5V has
        // propagated into elm.volts[0]. This one-step lag is the same
        // "read-last-converged-voltage" pattern GateElm.getInput() already
        // relies on elsewhere in this port, not a bug specific to this
        // element.
        hiT.position = 1;
        engine.stepOnce(); // T's node reaches 5V this step, but elm's rule check still used last step's (low) reading
        engine.stepOnce(); // NOW elm sees the rising edge -> rule fires -> Q set high
        expect(elm.volts[1]).toBeGreaterThan(2.5);

        // Hold T high for another step: pins[0]=true, lastValues[0] is now
        // ALSO true (saved last step) -> not a rising edge anymore -> rule
        // doesn't match -> Q holds at 1 (no rule resets it).
        engine.stepOnce();
        expect(elm.volts[1]).toBeGreaterThan(2.5);
    });

    it('rejects construction of a model whose rules use tri-state ("_") outputs', () => {
        undumpModelFromTokens(['tri-model', '0', 'A', 'B', 'tri-model', '1\\q_\\n0\\q0\\n']);
        expect(() => new CustomLogicElm(0, 0, 100, 0, 0, ['tri-model'])).toThrow(/tri-state/);
    });
});

describe('tests/custom.txt corpus (audit issue #2 part 1)', () => {
    // NOTE ON THE RESIDUAL "Singular matrix!": before this port, EVERY "208"
    // line failed to construct (unknown dump type), got preserved verbatim,
    // and analysis threw "Singular matrix!" simply because the circuit's
    // only logic-driving elements were missing. With CustomLogicElm
    // registered, all 6 "208" lines now construct (asserted below) -- but
    // parser.parse(text) STILL throws "Singular matrix!", for a DIFFERENT,
    // pre-existing reason unrelated to CustomLogicElm/SevenSegElm: this
    // fixture places a ClockElm (dump "164 288 160 336 160 ...") and a
    // RailElm (dump "R 288 160 224 160 ...") at the EXACT same coordinate,
    // (288,160) -- and again at (288,384). Both RailElm/ClockElm are
    // single-post elements referenced directly to ground (see voltage.ts),
    // so two independent voltage sources end up forced onto the very same
    // node: a genuine structural singularity (two different mandated
    // voltages on one node), not a defect in this port's CustomLogicElm/
    // SevenSegElm work. This was VERIFIED by isolating the failing 3x3
    // sub-matrix directly (see this task's own report) -- it contains only
    // that ClockElm+RailElm pair, no CustomLogicElm node at all. Fixing it
    // is out of this task's scope (it's a RailElm/ClockElm/topology
    // question, not the "!"-line rules engine or 7-segment port), so this
    // test asserts what this pass actually achieves -- construction, not
    // full analysis -- and documents the residual failure instead of
    // silently asserting something false.
    it('parses with its CustomLogic elements CONSTRUCTED (not preserved verbatim)', () => {
        const text = readFileSync(path.join(ROOT, 'tests', 'custom.txt'), 'utf8');
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);

        let threw: Error | null = null;
        try {
            parser.parse(text);
        } catch (e) {
            threw = e as Error;
        }
        // Document the residual failure precisely (see note above) rather
        // than asserting a blanket "doesn't throw" that isn't true yet.
        if (threw) {
            expect(threw.message).toBe('Singular matrix!');
        }

        const customElms = engine.elmList.filter(e => e instanceof CustomLogicElm);
        // 6 "208" lines in the fixture (2 comparator, 4 jkff instances).
        expect(customElms.length).toBe(6);

        const preservedCustomLines = engine.preservedLines.filter(l => l.startsWith('208 '));
        expect(preservedCustomLines.length).toBe(0);
    });
});
