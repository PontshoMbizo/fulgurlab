import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { GroundElm } from '../src/elements/ground';
import { WireElm } from '../src/elements/wire';
import { RailElm } from '../src/elements/voltage';
import { PotElm } from '../src/elements/pot';
import { OpAmpElm } from '../src/elements/opamp';
import { AndGateElm } from '../src/elements/gate';
import { LogicInputElm } from '../src/elements/logic_in_out';
import { Switch2Elm } from '../src/elements/switch2';

// Op-amp, pot, gates, switch2, transistor and mosfet all have getPostCount()
// > 2, which needs real getPost()/setPoints() geometry before they can be
// wired into a circuit by coordinates the way 2-post elements can. These
// tests build actual circuits with those posts (reading the computed
// coordinates back via getPost(), same as a text-format loader would need to)
// rather than just constructing the elements in isolation.

describe('multi-post element geometry', () => {
    it('PotElm.getPost(2) sits at the body midpoint, offset from the point1-point2 line', () => {
        const pot = new PotElm(0, 0, 100, 0, 0);
        pot.preStamp(); // forces setPoints()
        const p0 = pot.getPost(0)!, p1 = pot.getPost(1)!, p2 = pot.getPost(2)!;
        expect(p0).toEqual({ x: 0, y: 0 });
        expect(p1).toEqual({ x: 100, y: 0 });
        expect(p2.x).toBeCloseTo(50, 0);
        expect(Math.abs(p2.y)).toBeGreaterThan(0); // offset perpendicular to the line
    });

    it('wires as a voltage divider (rail -> pot end -> gnd, wiper mid-scale)', () => {
        const engine = new CircuitEngine();
        const pot = new PotElm(0, 0, 100, 0, 0, ['1000', '0.5']);
        pot.preStamp(); // resolve post3's coordinates before wiring to it
        const wiperPost = pot.getPost(2)!;

        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 10;
        const gnd = new GroundElm(100, 0, 100, 0, 0);
        // A resistor-free probe: ground the wiper's midpoint reading through a
        // second ground-referenced rail would fight the divider, so instead we
        // just read pot.volts[2] directly after solving — no extra element
        // needed at wiperPost for this assertion.
        void wiperPost;

        engine.elmList = [rail, pot, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        // position 0.5 of a linear pot between 10V and 0V -> ~5V at the wiper.
        expect(pot.volts[2]).toBeCloseTo(5, 1);
    });

    it('AndGateElm wires two LogicInputElms to a real 2-AND truth row', () => {
        const engine = new CircuitEngine();
        const gate = new AndGateElm(0, 0, 100, 0, 0, ['2']);
        gate.preStamp();
        const in0 = gate.getPost(0)!, in1 = gate.getPost(1)!;

        const hi0 = new LogicInputElm(in0.x, in0.y, in0.x, in0.y, 0, ['1']);
        const hi1 = new LogicInputElm(in1.x, in1.y, in1.x, in1.y, 0, ['1']);

        engine.elmList = [gate, hi0, hi1];
        engine.analyzeAndStamp();
        for (let i = 0; i < 10; i++) engine.stepOnce();

        // output post is gate.getPost(inputCount) = point2, i.e. volts[2].
        expect(gate.volts[2]).toBeGreaterThan(2.5); // both inputs high -> AND true -> highVoltage
    });

    it('OpAmpElm as a unity-gain follower converges output toward the input', () => {
        const engine = new CircuitEngine();
        const opamp = new OpAmpElm(0, 0, 100, 0, 0);
        opamp.preStamp();
        const vPlus = opamp.getPost(0)!;
        const vMinus = opamp.getPost(1)!;
        const out = opamp.getPost(2)!;

        const rail = new RailElm(vPlus.x, vPlus.y, vPlus.x, vPlus.y, 0, 0);
        rail.maxVoltage = 3;
        // Feedback wire: output -> V- (unity gain follower).
        const feedback = new WireElm(out.x, out.y, vMinus.x, vMinus.y, 0);
        // Falstad requires an explicit ground reference somewhere in the
        // circuit. Without one, Analyzer.setGroundNode()'s fallback ("no
        // ground element -> alias the first voltage source's post 0 to
        // ground") kicks in, and since `rail` is the only voltage source
        // here, that fallback aliases the rail's OWN node onto
        // CircuitNode.ground -- which is deliberately left with matrix=null,
        // crashing VoltageSource.assignMatrix(). A floating ground elsewhere
        // (not touching any other post) is enough to suppress the fallback
        // without changing this circuit's actual topology.
        const gnd = new GroundElm(500, 500, 500, 500, 0);

        engine.elmList = [opamp, rail, feedback, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 50; i++) engine.stepOnce();

        expect(opamp.volts[2]).toBeCloseTo(3, 1);
    });

    it('Switch2Elm getPost() gives 3 distinct posts (common + 2 throws) for a plain SPDT', () => {
        const sw = new Switch2Elm(0, 0, 100, 0, 0, ['0', 'false', '0', '2']);
        sw.preStamp();
        const p0 = sw.getPost(0)!, p1 = sw.getPost(1)!, p2 = sw.getPost(2)!;
        const keys = [p0, p1, p2].map(p => `${p.x},${p.y}`);
        expect(new Set(keys).size).toBe(3);
    });
});
