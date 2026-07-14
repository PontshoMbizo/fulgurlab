import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { ResistorElm } from '../src/elements/resistor';
import { GroundElm } from '../src/elements/ground';
import { RailElm, ClockElm, VoltageElm } from '../src/elements/voltage';
import { CapacitorElm } from '../src/elements/capacitor';
import { DiodeElm } from '../src/elements/diode';
import { LEDElm } from '../src/elements/led';
import { LogicInputElm, LogicOutputElm } from '../src/elements/logic_in_out';
import { AndGateElm, XnorGateElm } from '../src/elements/gate';
import { CurrentElm } from '../src/elements/current';
import { InverterElm } from '../src/elements/inverter';
import { Switch2Elm } from '../src/elements/switch2';
import { PotElm } from '../src/elements/pot';
import { OpAmpElm } from '../src/elements/opamp';
import { TransistorElm } from '../src/elements/transistor';
import { MosfetElm } from '../src/elements/mosfet';

// These elements were rebuilt from an uncommitted `dist/` build (the tracked
// source got reset before it was committed — see the session's git reflog).
// A few dump-type ids were wrong in that recovered code; this file both
// exercises a couple of end-to-end circuits and pins down the corrected ids
// so a regression here fails loudly instead of silently breaking .txt
// round-tripping later.

describe('dump type ids (must match CircuitElm.java getDumpType() exactly)', () => {
    it('uses the ids verified against the Java source, not the ones in the lost draft', () => {
        expect(new LogicInputElm(0, 0, 0, 0, 0).getDumpType()).toBe('L'); // was 'i'
        expect(new LogicOutputElm(0, 0, 0, 0, 0).getDumpType()).toBe('M'); // was 'O'
        expect(new XnorGateElm(0, 0, 0, 0, 0).getDumpType()).toBe('431'); // was '155'
        expect(new CurrentElm(0, 0, 0, 0, 0).getDumpType()).toBe('i');
        expect(new Switch2Elm(0, 0, 0, 0, 0).getDumpType()).toBe('S');
        expect(new InverterElm(0, 0, 0, 0, 0).getDumpType()).toBe('I');
        expect(new RailElm(0, 0, 0, 0, 0).getDumpType()).toBe('R');
        expect(new ClockElm(0, 0, 0, 0, 0).getDumpType()).toBe('164');
        expect(new AndGateElm(0, 0, 0, 0, 0).getDumpType()).toBe('150');
        expect(new PotElm(0, 0, 0, 0, 0).getDumpType()).toBe('174');
        expect(new LEDElm(0, 0, 0, 0, 0).getDumpType()).toBe('162');
    });
});

describe('base CircuitElm.setVoltageSource default', () => {
    it('assigns voltSource (Java CircuitElm.java:683-685 is not a no-op)', () => {
        // Regression test for a bug where the base default was a no-op, which
        // left OpAmpElm/GateElm/LogicInputElm/InverterElm with an undefined
        // voltSource because none of them override setVoltageSource themselves.
        const gate = new AndGateElm(0, 0, 10, 0, 0, ['2']);
        expect(gate.voltSource).toBeUndefined();
        const vs = {} as any;
        gate.setVoltageSource(0, vs);
        expect(gate.voltSource).toBe(vs);
    });
});

describe('RC charging circuit (rail -> resistor -> capacitor -> ground)', () => {
    it('charges toward the rail voltage', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0); // single post at (0,0), DC, default 5V
        const r1 = new ResistorElm(0, 0, 10, 0, 0, 1000);
        const cap = new CapacitorElm(10, 0, 10, 10, 0, 1e-6);
        const gnd = new GroundElm(10, 10, 10, 10, 0);

        engine.elmList = [rail, r1, cap, gnd];
        engine.analyzeAndStamp();

        // tau = R*C = 1ms; run 25 tau worth of steps at the default 5us timestep.
        const steps = Math.round(25 * 1e-3 / engine.timeStep);
        for (let i = 0; i < steps; i++) engine.stepOnce();

        expect(cap.volts[0]).toBeCloseTo(5, 2);
    });
});

describe('diode clipper-ish sanity (rail -> diode -> ground, no series R)', () => {
    it('forward drop stays in the expected ~0.6-0.8V ballpark under a stiffening pull-down', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        (rail as VoltageElm).maxVoltage = 5;
        const r1 = new ResistorElm(0, 0, 10, 0, 0, 1000);
        const diode = new DiodeElm(10, 0, 10, 10, 0);
        const gnd = new GroundElm(10, 10, 10, 10, 0);

        engine.elmList = [rail, r1, diode, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 200; i++) engine.stepOnce();

        const vf = diode.volts[0] - diode.volts[1];
        expect(vf).toBeGreaterThan(0.4);
        expect(vf).toBeLessThan(1.0);
    });
});

describe('logic input -> logic output (direct node share, no gate)', () => {
    it('reads back H when the input is driven high', () => {
        const engine = new CircuitEngine();
        const hi = new LogicInputElm(0, 0, 0, 0, 0, ['1']);
        const out = new LogicOutputElm(0, 0, 0, 0, 0);
        engine.elmList = [hi, out];
        engine.analyzeAndStamp();
        for (let i = 0; i < 10; i++) engine.stepOnce();
        out.calculateCurrent();
        expect(out.value).toBe('H');
    });
});
