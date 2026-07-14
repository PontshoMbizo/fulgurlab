import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { GroundElm } from '../src/elements/ground';
import { RailElm } from '../src/elements/voltage';
import { ResistorElm } from '../src/elements/resistor';
import { OutputElm } from '../src/elements/output';
import { ProbeElm } from '../src/elements/probe';
import { AmmeterElm } from '../src/elements/ammeter';
import { LabeledNodeElm } from '../src/elements/labeled_node';
import { TextElm } from '../src/elements/text';
import { BoxElm } from '../src/elements/box';
import { ZenerElm } from '../src/elements/zener';
import { DiodeElm } from '../src/elements/diode';
import { createElement } from '../src/core/factory';

describe('OutputElm / ProbeElm / AmmeterElm', () => {
    it('OutputElm reads a node voltage without perturbing the circuit', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        const r = new ResistorElm(0, 0, 100, 0, 0, 1000);
        const gnd = new GroundElm(100, 0, 100, 0, 0);
        const out = new OutputElm(0, 0, 0, 0, 0);

        expect(out.getDumpType()).toBe('O');

        engine.elmList = [rail, r, gnd, out];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(out.getVoltageDiff()).toBeCloseTo(5, 1);
        // A passive probe must not load the rail: current through r should
        // equal exactly what a plain rail->r->gnd circuit would give (5mA).
        expect(r.current).toBeCloseTo(0.005, 3);
    });

    it('ProbeElm defaults to resistance=0 when built from dump tokens (does not perturb the circuit)', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        const r = new ResistorElm(0, 0, 100, 0, 0, 1000);
        const gnd = new GroundElm(100, 0, 100, 0, 0);
        const probe = new ProbeElm(0, 0, 100, 0, 0, ['0', '0', '0']);

        expect(probe.getDumpType()).toBe('p');
        expect(probe.getConnection(0, 1)).toBe(false);

        engine.elmList = [rail, r, gnd, probe];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(probe.getVoltageDiff()).toBeCloseTo(5, 1);
        expect(r.current).toBeCloseTo(0.005, 3);
    });

    it('ProbeElm with nonzero resistance stamps a resistor and does load the circuit', () => {
        const probe = new ProbeElm(0, 0, 100, 0, 0, ['0', '0', '1000']);
        expect(probe.getConnection(0, 1)).toBe(true);
        expect(probe.resistance).toBe(1000);
    });

    it('AmmeterElm reads series current as an ideal (zero-drop) element', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 10;
        const am = new AmmeterElm(0, 0, 50, 0, 0, ['0', '0']);
        const r = new ResistorElm(50, 0, 100, 0, 0, 2000);
        const gnd = new GroundElm(100, 0, 100, 0, 0);

        expect(am.getDumpType()).toBe(370);

        engine.elmList = [rail, am, r, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        // 10V / 2000ohm = 5mA, and the ammeter itself should drop ~0V.
        expect(r.current).toBeCloseTo(0.005, 3);
        expect(Math.abs(am.volts[0] - am.volts[1])).toBeLessThan(1e-6);
    });
});

describe('LabeledNodeElm', () => {
    it('two labeled nodes sharing the same text are tied to one electrical node', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 9;
        const r1 = new ResistorElm(0, 0, 50, 0, 0, 1000);
        const labelA = new LabeledNodeElm(50, 0, 50, 0, 0, ['bus1']);
        // A second labeled node, far away on the canvas, with no wire at all
        // connecting it to the first -- only the shared text ties them.
        const labelB = new LabeledNodeElm(500, 500, 500, 500, 0, ['bus1']);
        const r2 = new ResistorElm(500, 500, 600, 500, 0, 1000);
        const gnd = new GroundElm(600, 500, 600, 500, 0);

        expect(labelA.getDumpType()).toBe(207);
        expect(labelA.text).toBe('bus1');

        engine.elmList = [rail, r1, labelA, labelB, r2, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        // 9V across two 1k resistors in series (via the shared label node) -> 4.5V at the label, 4.5mA.
        expect(labelA.getVoltageDiff()).toBeCloseTo(4.5, 1);
        expect(r1.current).toBeCloseTo(0.0045, 3);
        expect(r2.current).toBeCloseTo(0.0045, 3);
    });

    it('a differently-labeled node is NOT connected to the first', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 9;
        const r1 = new ResistorElm(0, 0, 50, 0, 0, 1000);
        const labelA = new LabeledNodeElm(50, 0, 50, 0, 0, ['bus1']);
        const labelC = new LabeledNodeElm(500, 500, 500, 500, 0, ['other']);
        const gnd = new GroundElm(500, 500, 500, 500, 0);

        engine.elmList = [rail, r1, labelA, labelC, gnd];
        // Distinct labels shouldn't be merged -- labelA's branch is a dead
        // end (nothing sinks its current), so this circuit is genuinely
        // unconnected/underdetermined; just check analysis doesn't silently
        // merge them into a coincidentally-solvable single node.
        engine.analyzeAndStamp();
        expect(engine.nodeList.length).toBeGreaterThanOrEqual(3); // ground + at least 2 distinct real nodes
    });
});

describe('GroundElm', () => {
    it('multiple GroundElm instances at different coordinates are all the same node', () => {
        const engine = new CircuitEngine();
        const rail1 = new RailElm(0, 0, 0, 0, 0, 0);
        rail1.maxVoltage = 5;
        const r1 = new ResistorElm(0, 0, 50, 0, 0, 1000);
        const gnd1 = new GroundElm(50, 0, 50, 0, 0);

        const rail2 = new RailElm(200, 0, 200, 0, 0, 0);
        rail2.maxVoltage = 3;
        const r2 = new ResistorElm(200, 0, 250, 0, 0, 1000);
        const gnd2 = new GroundElm(250, 0, 250, 0, 0);

        engine.elmList = [rail1, r1, gnd1, rail2, r2, gnd2];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        // Two independent rail->resistor->ground branches must solve
        // independently and correctly -- this only works if gnd1 and gnd2
        // are really the same reference node.
        expect(r1.current).toBeCloseTo(0.005, 3);
        expect(r2.current).toBeCloseTo(0.003, 3);
    });

    it('a rail-only circuit with no explicit GroundElm still solves (gotRail fallback fix)', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        const r = new ResistorElm(0, 0, 100, 0, 0, 1000);
        // No GroundElm at all. Before the gotRail fix, setGroundNode()'s
        // "no ground -> alias first voltage source's post to ground"
        // fallback would incorrectly fire here (rail has no isRail() check),
        // aliasing the rail's own node onto CircuitNode.ground and crashing
        // the solver. With isRail() wired up, the fallback must not fire,
        // and RailElm's own hardcoded CircuitNode.ground reference in
        // stamp() is enough of a reference on its own.

        engine.elmList = [rail, r];
        expect(() => engine.analyzeAndStamp()).not.toThrow();
        expect(() => engine.stepOnce()).not.toThrow();
    });
});

describe('ZenerElm / TextElm / BoxElm', () => {
    it('ZenerElm defaults to a nonzero breakdown voltage, unlike a plain DiodeElm', () => {
        const zener = new ZenerElm(0, 0, 100, 0, 0);
        const diode = new DiodeElm(0, 0, 100, 0, 0);
        expect(zener.getDumpType()).toBe('z');
        expect(zener.model.breakdownVoltage).toBeCloseTo(5.6, 5);
        expect(diode.model.breakdownVoltage).toBe(0);
    });

    it('TextElm and BoxElm are zero-post graphic annotations that round-trip their dump fields', () => {
        const text = new TextElm(10, 20, 0, 0, 0, ['24', 'hello', 'world']);
        expect(text.getDumpType()).toBe('x');
        expect(text.getPostCount()).toBe(0);
        expect(text.size).toBe(24);
        expect(text.text).toBe('hello world');

        const box = new BoxElm(0, 0, 50, 50, 0);
        expect(box.getDumpType()).toBe('b');
        expect(box.getPostCount()).toBe(0);
    });
});

describe('factory dump-id wiring for new elements', () => {
    it('createElement resolves all newly registered dump ids', () => {
        expect(createElement('O', 0, 0, 0, 0, 0, [])).toBeInstanceOf(OutputElm);
        expect(createElement('p', 0, 0, 100, 0, 0, ['0', '0', '0'])).toBeInstanceOf(ProbeElm);
        expect(createElement('207', 0, 0, 0, 0, 0, ['n'])).toBeInstanceOf(LabeledNodeElm);
        expect(createElement('x', 0, 0, 0, 0, 0, ['24', 'hi'])).toBeInstanceOf(TextElm);
        expect(createElement('b', 0, 0, 50, 50, 0, [])).toBeInstanceOf(BoxElm);
        expect(createElement('370', 0, 0, 50, 0, 0, ['0', '0'])).toBeInstanceOf(AmmeterElm);
        expect(createElement('z', 0, 0, 100, 0, 0, [])).toBeInstanceOf(ZenerElm);
    });
});
