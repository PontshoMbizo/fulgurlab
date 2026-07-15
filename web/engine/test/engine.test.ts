import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { ResistorElm } from '../src/elements/resistor';
import { GroundElm } from '../src/elements/ground';
import { VoltageElm, RailElm } from '../src/elements/voltage';
import { AmmeterElm } from '../src/elements/ammeter';
import { CurrentElm } from '../src/elements/current';
import { VCCSElm, VCVSElm, CCVSElm, CCCSElm } from '../src/elements/dependent_sources';
import { InvertingSchmittElm, SchmittElm } from '../src/elements/schmitt';
import { AnalogSwitchElm, AnalogSwitch2Elm } from '../src/elements/analog_switch';
import { ComparatorElm } from '../src/elements/comparator';
import { OTAElm } from '../src/elements/ota';
import { TriStateElm } from '../src/elements/tristate';
import { DelayBufferElm, TimeDelayRelayElm } from '../src/elements/delay';

describe('CircuitEngine', () => {
    it('solves a simple resistor divider', () => {
        const engine = new CircuitEngine();
        
        // vs node 0 is (10,0), node 1 is (0,10)
        const vs = new VoltageElm(10, 0, 0, 10, 0, 0); // DC 5V
        vs.maxVoltage = 5;
        
        // r1 node 0 is (0,10), node 1 is (10,10)
        const r1 = new ResistorElm(0, 10, 10, 10, 0, 100);
        // r2 node 0 is (10,10), node 1 is (10,0)
        const r2 = new ResistorElm(10, 10, 10, 0, 0, 100);
        
        // gnd is at (10,0)
        const gnd = new GroundElm(10, 0, 10, 0, 0);
        
        engine.elmList = [vs, r1, r2, gnd];
        
        engine.analyzeAndStamp();
        engine.stepOnce();
        
        expect(vs.volts[0]).toBeCloseTo(0);
        expect(vs.volts[1]).toBeCloseTo(5);
        
        expect(r1.volts[0]).toBeCloseTo(5);
        expect(r1.volts[1]).toBeCloseTo(2.5);
        
        expect(r2.volts[0]).toBeCloseTo(2.5);
        expect(r2.volts[1]).toBeCloseTo(0);
        
        expect(gnd.volts[0]).toBeCloseTo(0);
    });

    // Regression test for a bug caught this session while implementing
    // current-controlled dependent sources: a voltage source's own branch
    // current is itself one of the solved matrix unknowns (see
    // VoltageSource.current's comment in core/node.ts), but nothing
    // extracted it before -- VoltageElm/RailElm/ClockElm/AmmeterElm/
    // OpAmpElm's `.current` stayed permanently 0 regardless of what the
    // circuit was actually doing. Fixed via applySolvedRightSide() reading
    // each matrix's voltageSourceList and dispatching to each owning
    // element's setCurrent(vs, c) (CircuitElm.setCurrent()'s comment in
    // base.ts -- byte-faithful to Java's own applySolvedRightSide(), which
    // calls `vs.elm.setCurrent(vs, res)` the same way).
    it('voltage-source-based elements report the correct branch current (not stuck at 0)', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 9;
        const r = new ResistorElm(0, 0, 100, 0, 0, 3000);
        const am = new AmmeterElm(100, 0, 200, 0, 0, []);
        const gnd = new GroundElm(200, 0, 200, 0, 0);
        engine.elmList = [rail, r, am, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(r.current).toBeCloseTo(0.003);
        // Same series loop -- the rail and ammeter must report the EXACT
        // same current as the resistor, not 0.
        expect(rail.current).toBeCloseTo(r.current);
        expect(am.current).toBeCloseTo(r.current);
    });

    // Regression test for a subtler timing bug this session's setCurrent()
    // refactor fixed as a side effect: AmmeterElm.stepFinished() (which
    // drives its min/max/rms stats, and sets `selectedValue` from
    // `this.current` in AM_VOL mode -- the default) runs BEFORE
    // calcWireCurrents() in stepOnce()'s own ordering (see engine.ts). An
    // earlier version of the branch-current fix populated `.current` via a
    // calculateCurrent() override, which only runs from calcWireCurrents()
    // -- AFTER stepFinished() in the SAME call -- so on every step,
    // stepFinished() would see the PREVIOUS step's current (0 on the very
    // first step). Dispatching through setCurrent() instead (called from
    // applySolvedRightSide(), well before stepFinished()) fixes this: even
    // on the first ever step, selectedValue must already reflect that same
    // step's freshly-solved current, not 0.
    it('AmmeterElm.selectedValue reflects the current step\'s current, even on the very first step', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        const r = new ResistorElm(0, 0, 100, 0, 0, 1000);
        const am = new AmmeterElm(100, 0, 200, 0, 0, []);
        const gnd = new GroundElm(200, 0, 200, 0, 0);
        engine.elmList = [rail, r, am, gnd];
        engine.analyzeAndStamp();
        engine.stepOnce();

        expect(am.current).toBeCloseTo(0.005);
        // If stepFinished() ran on stale (pre-solve) current, selectedValue
        // would still be its uninitialized default (0) after this first step.
        expect(am.selectedValue).toBeCloseTo(0.005);
    });
});

// Regression coverage for the Analog Active Building Blocks group's 4
// simplified fixed-gain dependent sources (see dependent_sources.ts's header
// comment for the ChipElm/ExprParser simplification rationale). Each test
// calls preStamp() and reads back getPost() rather than hand-computing
// coordinates, since the exact post positions depend on DependentSourceElm's
// interpPoint2-based geometry -- the same technique OpAmpElm's own tests use.
//
// This block also locks in two bugs this session's own verification script
// caught (both real, both fixed with root-cause understanding -- see
// voltage.ts's and dependent_sources.ts's own bugfix comments):
//   1. VoltageElm.setVoltageSource() (and therefore RailElm etc.) never
//      called vs.setNodes(...), so VoltageSource.assignMatrix() always fell
//      back to "this element's last post's matrix" -- null whenever that
//      post happened to be the literal ground node.
//   2. VCVSElm had the identical gap for its own output-side voltage source.
// Both are exercised implicitly by every test below that grounds a
// dependent-source's LAST post (out-, post index 3) -- exactly the crash
// this session hit before the fix.
describe('Dependent sources (VCCS/VCVS/CCVS/CCCS)', () => {
    it('VCCSElm: Iout = gain*(Vctrl+ - Vctrl-), sensed via a load resistor', () => {
        const gain = 0.01, R = 1000, Vctrl = 3;
        const vccs = new VCCSElm(0, 0, 100, 0, 0, [String(gain)]);
        vccs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => vccs.getPost(n)!);

        const engine = new CircuitEngine();
        const railP = new RailElm(p0.x, p0.y, p0.x, p0.y, 0, 0);
        railP.maxVoltage = Vctrl;
        const gndM = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, R);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        engine.elmList = [vccs, railP, gndM, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(vccs.getVoltageDiff()).toBeCloseTo(gain * Vctrl * R);
        expect(load.current).toBeCloseTo(gain * Vctrl);
        expect(vccs.current).toBeCloseTo(gain * Vctrl);
    });

    it('VCVSElm: Vout = gain*Vctrl exactly, independent of load', () => {
        const gain = 2, Vctrl = 3;
        for (const R of [500, 2000]) {
            const vcvs = new VCVSElm(0, 0, 100, 0, 0, [String(gain)]);
            vcvs.preStamp();
            const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => vcvs.getPost(n)!);

            const engine = new CircuitEngine();
            const railP = new RailElm(p0.x, p0.y, p0.x, p0.y, 0, 0);
            railP.maxVoltage = Vctrl;
            const gndM = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
            const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, R);
            const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
            engine.elmList = [vcvs, railP, gndM, load, gndOut];
            engine.analyzeAndStamp();
            for (let i = 0; i < 5; i++) engine.stepOnce();

            expect(vcvs.getVoltageDiff()).toBeCloseTo(gain * Vctrl);
            // The .current bugfix (VoltageSource.current, see node.ts) applies
            // here too -- a VCVS is a voltage source and should report a
            // nonzero branch current once loaded.
            expect(vcvs.current).not.toBe(0);
        }
    });

    it('CCVSElm: senses a control current and outputs Vout = gain*Ictrl', () => {
        const gain = 100, Ictrl = 0.005;
        const ccvs = new CCVSElm(0, 0, 100, 0, 0, [String(gain)]);
        ccvs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => ccvs.getPost(n)!);

        const engine = new CircuitEngine();
        const isrc = new CurrentElm(p0.x, p0.y, p1.x, p1.y, 0, [String(Ictrl), '0']);
        const gndCtrl = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, 1e6);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        engine.elmList = [ccvs, isrc, gndCtrl, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(Math.abs(ccvs.controlVS.current)).toBeCloseTo(Ictrl);
        expect(ccvs.getVoltageDiff()).toBeCloseTo(gain * ccvs.controlVS.current);
        // Regression check for CCVSElm's setCurrent(vs, c) override: with
        // TWO voltage sources on this element, `current` must reflect
        // outputVS specifically (same series branch as the load resistor),
        // not whichever VS the base class's default dispatch happened to
        // process last, and NOT controlVS's much smaller sensed Ictrl
        // (see dependent_sources.ts).
        expect(ccvs.current).toBeCloseTo(load.current);
    });

    it('CCCSElm: senses a control current and outputs Iout = gain*Ictrl', () => {
        const gain = 10, Ictrl = 0.002, Rload = 1000;
        const cccs = new CCCSElm(0, 0, 100, 0, 0, [String(gain)]);
        cccs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => cccs.getPost(n)!);

        const engine = new CircuitEngine();
        const isrc = new CurrentElm(p0.x, p0.y, p1.x, p1.y, 0, [String(Ictrl), '0']);
        const gndCtrl = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, Rload);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        engine.elmList = [cccs, isrc, gndCtrl, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(Math.abs(cccs.controlVS.current)).toBeCloseTo(Ictrl);
        expect(load.current).toBeCloseTo(gain * cccs.controlVS.current);
        // Regression check for CCCSElm's setCurrent(vs, c) override: this
        // element's own `current` must be the OUTPUT current (gain*Ictrl),
        // not the raw sensed control current the base class default would
        // otherwise leave it as (see dependent_sources.ts).
        expect(cccs.current).toBeCloseTo(load.current);
    });
});

// Regression coverage for the Analog Active Building Blocks group's batch 2
// (switches, Schmitt triggers, comparator, OTA). Several of these tests
// lock in polarity/sign conventions this session's own verification script
// got wrong on the first attempt (by assuming an "intuitive" behavior
// instead of reading the oracle source carefully) -- the comments explain
// the confirmed-against-Java behavior so a future refactor can't silently
// flip it back to the "intuitive but wrong" version.
describe('Analog Building Blocks batch 2 (Schmitt/AnalogSwitch/Comparator/OTA)', () => {
    it('InvertingSchmittElm: output HIGH when input below lowerTrigger, LOW when above upperTrigger', () => {
        const sch = new InvertingSchmittElm(0, 0, 100, 0, 0, []);
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 0;
        const engine = new CircuitEngine();
        engine.elmList = [sch, rail];
        engine.analyzeAndStamp();
        for (let i = 0; i < 20; i++) engine.stepOnce();
        expect(sch.volts[1]).toBeCloseTo(5, 0);

        rail.maxVoltage = 5;
        engine.analyzeAndStamp();
        for (let i = 0; i < 500; i++) engine.stepOnce();
        expect(sch.volts[1]).toBeCloseTo(0, 0);
    });

    it('SchmittElm: non-inverting -- output LOW when input low, HIGH when input high', () => {
        const sch = new SchmittElm(0, 0, 100, 0, 0, []);
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        const engine = new CircuitEngine();
        engine.elmList = [sch, rail];
        engine.analyzeAndStamp();
        for (let i = 0; i < 500; i++) engine.stepOnce();
        expect(sch.volts[1]).toBeCloseTo(5, 0);
    });

    // Confirmed directly against AnalogSwitchElm.java's doStep(): `open =
    // (volts[control] < threshold)`. Control BELOW threshold -> open=true ->
    // resistance=r_off (non-conducting). Control ABOVE threshold ->
    // open=false -> resistance=r_on (conducting). Easy to misremember as the
    // opposite; this test would catch that regression.
    it('AnalogSwitchElm: closes (conducts) when control is ABOVE threshold, not below', () => {
        const sw = new AnalogSwitchElm(0, 0, 100, 0, 0, ['20', '1e10', '2.5']);
        sw.preStamp();
        const [p0, p1, p2] = [0, 1, 2].map(n => sw.getPost(n)!);
        const railA = new RailElm(p0.x, p0.y, p0.x, p0.y, 0, 0);
        railA.maxVoltage = 5;
        const load = new ResistorElm(p1.x, p1.y, p1.x + 50, p1.y, 0, 1000);
        const gndLoad = new GroundElm(p1.x + 50, p1.y, p1.x + 50, p1.y, 0);
        const ctrlRail = new RailElm(p2.x, p2.y, p2.x, p2.y, 0, 0);
        ctrlRail.maxVoltage = 5; // above threshold
        const engine = new CircuitEngine();
        engine.elmList = [sw, railA, load, gndLoad, ctrlRail];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(sw.open).toBe(false);
        expect(load.volts[0]).toBeGreaterThan(4.5); // conducting: ~4.9V through r_on

        ctrlRail.maxVoltage = 0; // below threshold
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(sw.open).toBe(true);
        expect(load.volts[0]).toBeCloseTo(0, 1); // open: floating near 0V
    });

    // Confirmed directly against AnalogSwitch2Elm.java's doStep(): when
    // open=true it stamps r_on to nodes[2] (throw B), NOT nodes[1] (throw
    // A) -- the reverse of what the "A comes before B" ordering might
    // suggest.
    it('AnalogSwitch2Elm: open (control below threshold) throws to post2, not post1', () => {
        const sw = new AnalogSwitch2Elm(0, 0, 100, 0, 0, ['20', '1e10', '2.5']);
        sw.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => sw.getPost(n)!);
        const common = new RailElm(p0.x, p0.y, p0.x, p0.y, 0, 0);
        common.maxVoltage = 9;
        const loadA = new ResistorElm(p1.x, p1.y, p1.x + 50, p1.y, 0, 1000);
        const gndA = new GroundElm(p1.x + 50, p1.y, p1.x + 50, p1.y, 0);
        const loadB = new ResistorElm(p2.x, p2.y, p2.x + 50, p2.y, 0, 1000);
        const gndB = new GroundElm(p2.x + 50, p2.y, p2.x + 50, p2.y, 0);
        const ctrlRail = new RailElm(p3.x, p3.y, p3.x, p3.y, 0, 0);
        ctrlRail.maxVoltage = 0; // below threshold -> open -> throw B
        const engine = new CircuitEngine();
        engine.elmList = [sw, common, loadA, gndA, loadB, gndB, ctrlRail];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(loadB.volts[0]).toBeGreaterThan(8); // throw B conducts
        expect(loadA.volts[0]).toBeCloseTo(0, 0); // throw A floats
    });

    // Confirmed against the reverse-engineered internal model (see
    // comparator.ts's header comment): open-drain output SINKS (pulled
    // toward ground) when (+) > (-), and floats (pullup wins) when (+) < (-)
    // -- the opposite polarity from a push-pull comparator.
    it('ComparatorElm: open-drain output sinks LOW when (+) > (-)', () => {
        const cmp = new ComparatorElm(0, 0, 100, 0, 0, []);
        cmp.preStamp();
        const [pPlus, pMinus, pOut] = [0, 1, 2].map(n => cmp.getPost(n)!);
        const railP = new RailElm(pPlus.x, pPlus.y, pPlus.x, pPlus.y, 0, 0);
        railP.maxVoltage = 3;
        const railM = new RailElm(pMinus.x, pMinus.y, pMinus.x, pMinus.y, 0, 0);
        railM.maxVoltage = 1;
        const pullup = new ResistorElm(pOut.x, pOut.y, pOut.x + 50, pOut.y, 0, 10000);
        const vcc = new RailElm(pOut.x + 50, pOut.y, pOut.x + 50, pOut.y, 0, 0);
        vcc.maxVoltage = 5;
        const engine = new CircuitEngine();
        engine.elmList = [cmp, railP, railM, pullup, vcc];
        engine.analyzeAndStamp();
        for (let i = 0; i < 500; i++) engine.stepOnce();
        expect(cmp.volts[2]).toBeLessThan(0.5); // (+)>(-) -> sinks low

        railP.maxVoltage = 0;
        railM.maxVoltage = 3; // now (+) < (-)
        engine.analyzeAndStamp();
        for (let i = 0; i < 500; i++) engine.stepOnce();
        expect(cmp.volts[2]).toBeGreaterThan(4.5); // floats -- pullup wins
    });

    // Sign of the OTA's output stamp was flipped in this file's first draft
    // (caught by this exact test's ancestor in the app-side verification
    // script) -- Vout must come out POSITIVE for a positive Vin, matching
    // the "sources current out of a grounded load" convention this port's
    // own VCCSElm already establishes.
    it('OTAElm: Iout = gm*(Vin+-Vin-), gm = Iabc/(2*VT), with the correct (sourcing) sign', () => {
        const ota = new OTAElm(0, 0, 100, 0, 0, []);
        ota.preStamp();
        const [pPlus, pMinus, pIabc, pOut] = [0, 1, 2, 3].map(n => ota.getPost(n)!);
        const Vin = 0.01, Iabc = 0.0005, Rload = 1000;
        const railP = new RailElm(pPlus.x, pPlus.y, pPlus.x, pPlus.y, 0, 0);
        railP.maxVoltage = Vin;
        const gndM = new GroundElm(pMinus.x, pMinus.y, pMinus.x, pMinus.y, 0);
        const isrc = new CurrentElm(pIabc.x, pIabc.y, pIabc.x + 40, pIabc.y, 0, [String(Iabc), '0']);
        const gndIsrc = new GroundElm(pIabc.x + 40, pIabc.y, pIabc.x + 40, pIabc.y, 0);
        const load = new ResistorElm(pOut.x, pOut.y, pOut.x + 50, pOut.y, 0, Rload);
        const gndOut = new GroundElm(pOut.x + 50, pOut.y, pOut.x + 50, pOut.y, 0);
        const engine = new CircuitEngine();
        engine.elmList = [ota, railP, gndM, isrc, gndIsrc, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 10; i++) engine.stepOnce();

        const expectedVout = (Iabc / (2 * OTAElm.VT)) * Vin * Rload;
        expect(expectedVout).toBeGreaterThan(0); // sanity on the test's own arithmetic
        expect(ota.volts[3]).toBeCloseTo(expectedVout, 2);
        expect(ota.current).toBeCloseTo(load.current, 5);
    });
});

// Regression coverage for the Analog Active Building Blocks group's batch 3
// (tri-state buffer, delay buffer, time-delay relay). Current conveyors
// (CC2Elm/CC2NegElm) are excluded per this project's own earlier scoping
// decision, not implemented here.
describe('Analog Building Blocks batch 3 (TriState/DelayBuffer/TimeDelayRelay)', () => {
    // Confirmed against TriStateElm.java's doStep(): `open = (volts[control]
    // < highVoltage*0.5)` -- same polarity direction as AnalogSwitchElm
    // (control below half-highVoltage means open/high-Z), not the reverse.
    it('TriStateElm: drives input through when control is HIGH, floats (pulled to gnd) when LOW', () => {
        const ts = new TriStateElm(0, 0, 100, 0, 0, ['0.1', '1e10', '1e8', '5']);
        ts.preStamp();
        const [pIn, pOut, pCtrl] = [0, 1, 2].map(n => ts.getPost(n)!);
        const railIn = new RailElm(pIn.x, pIn.y, pIn.x, pIn.y, 0, 0);
        railIn.maxVoltage = 5;
        const load = new ResistorElm(pOut.x, pOut.y, pOut.x + 50, pOut.y, 0, 1e6);
        const gndLoad = new GroundElm(pOut.x + 50, pOut.y, pOut.x + 50, pOut.y, 0);
        const railCtrl = new RailElm(pCtrl.x, pCtrl.y, pCtrl.x, pCtrl.y, 0, 0);
        railCtrl.maxVoltage = 5; // enabled (>= highVoltage*0.5)
        const engine = new CircuitEngine();
        engine.elmList = [ts, railIn, load, gndLoad, railCtrl];
        engine.analyzeAndStamp();
        for (let i = 0; i < 20; i++) engine.stepOnce();
        expect(ts.open).toBe(false);
        expect(ts.volts[1]).toBeCloseTo(5, 1);

        railCtrl.maxVoltage = 0; // disabled (< highVoltage*0.5)
        engine.analyzeAndStamp();
        for (let i = 0; i < 20; i++) engine.stepOnce();
        expect(ts.open).toBe(true);
        expect(ts.volts[1]).toBeCloseTo(0, 0); // floats, pulled toward gnd by r_off_ground
    });

    it('DelayBufferElm: only propagates an input change after `delay` seconds have elapsed', () => {
        const delay = 0.001; // 1ms
        const buf = new DelayBufferElm(0, 0, 100, 0, 0, [String(delay), '2.5', '5']);
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 0;
        const engine = new CircuitEngine();
        engine.elmList = [buf, rail];
        engine.timeStep = 1e-5; // 10us -- delay is 100 steps
        engine.analyzeAndStamp();
        for (let i = 0; i < 20; i++) engine.stepOnce();
        expect(buf.volts[1]).toBeCloseTo(0, 1);

        rail.maxVoltage = 5; // input jumps HIGH
        engine.analyzeAndStamp();
        engine.stepOnce(); // one step later -- must NOT have propagated yet
        expect(buf.volts[1]).toBeCloseTo(0, 1);

        for (let i = 0; i < 200; i++) engine.stepOnce(); // well past the 1ms delay
        expect(buf.volts[1]).toBeCloseTo(5, 1);
    });

    it('TimeDelayRelayElm: contact only switches onResistance/offResistance after onDelay elapses', () => {
        const onDelay = 0.01, offDelay = 0.005, onR = 5, offR = 1e6, Rload = 1000;
        const relay = new TimeDelayRelayElm(0, 0, 100, 0, 0, [String(onDelay), String(offDelay), String(onR), String(offR)]);
        relay.preStamp();
        const [pVin, pGnd, pIn, pOut] = [0, 1, 2, 3].map(n => relay.getPost(n)!);
        const coilRail = new RailElm(pVin.x, pVin.y, pVin.x, pVin.y, 0, 0);
        coilRail.maxVoltage = 0; // coil de-energized
        const gndCoil = new GroundElm(pGnd.x, pGnd.y, pGnd.x, pGnd.y, 0);
        const sigRail = new RailElm(pIn.x, pIn.y, pIn.x, pIn.y, 0, 0);
        sigRail.maxVoltage = 9;
        const load = new ResistorElm(pOut.x, pOut.y, pOut.x + 50, pOut.y, 0, Rload);
        const gndOut = new GroundElm(pOut.x + 50, pOut.y, pOut.x + 50, pOut.y, 0);
        const engine = new CircuitEngine();
        engine.elmList = [relay, coilRail, gndCoil, sigRail, load, gndOut];
        engine.timeStep = 1e-4;
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(load.volts[0]).toBeCloseTo(0, 0); // de-energized -> contact open

        coilRail.maxVoltage = 9; // energize the coil
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(load.volts[0]).toBeCloseTo(0, 0); // onDelay not yet elapsed -> still open

        for (let i = 0; i < 200; i++) engine.stepOnce(); // well past onDelay (100 steps)
        // Vout is measured across the load in the sigRail--relay.resistance--load--gnd
        // divider, so the load's share is load/(load+resistance), not the reverse.
        const expectedOnV = 9 * Rload / (Rload + onR);
        expect(load.volts[0]).toBeCloseTo(expectedOnV, 0);
        expect(relay.onState).toBe(true);
    });
});
