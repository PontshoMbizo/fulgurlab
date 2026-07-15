import { describe, it, expect } from 'vitest';
import { createElement } from '../src/core/factory';
import { CircuitParser } from '../src/core/parser';
import { CircuitEngine } from '../src/core/engine';
import { CircuitElm } from '../src/elements/base';
import { ResistorElm } from '../src/elements/resistor';
import { CapacitorElm } from '../src/elements/capacitor';
import { InductorElm } from '../src/elements/inductor';
import { VoltageElm, RailElm, ClockElm } from '../src/elements/voltage';
import { SwitchElm } from '../src/elements/switch';
import { Switch2Elm } from '../src/elements/switch2';
import { DiodeElm } from '../src/elements/diode';
import { ZenerElm } from '../src/elements/zener';
import { LEDElm } from '../src/elements/led';
import { TransistorElm } from '../src/elements/transistor';
import { MosfetElm } from '../src/elements/mosfet';
import { AndGateElm } from '../src/elements/gate';
import { GroundElm } from '../src/elements/ground';
import { CurrentElm } from '../src/elements/current';
import { AmmeterElm } from '../src/elements/ammeter';
import { ProbeElm } from '../src/elements/probe';
import { OutputElm } from '../src/elements/output';
import { LabeledNodeElm } from '../src/elements/labeled_node';
import { TextElm } from '../src/elements/text';
import { BoxElm } from '../src/elements/box';
import { WireElm } from '../src/elements/wire';
import { LogicInputElm, LogicOutputElm } from '../src/elements/logic_in_out';
import { InverterElm } from '../src/elements/inverter';
import { OpAmpElm } from '../src/elements/opamp';
import { PotElm } from '../src/elements/pot';

// Exercises the REAL path a save/load or undo/redo snapshot would take:
// dump() -> whitespace tokenize (same as CircuitParser's line tokenizer) ->
// createElement(). Not just calling dumpTokens() directly -- this also
// catches a mismatch between what dump() emits and what createElement's
// dumpType lookup + the constructor's own params parsing actually consumes.
function roundTrip(elm: CircuitElm): CircuitElm {
    const line = elm.dump();
    const tokens = line.trim().split(/\s+/).filter(t => t.length > 0);
    const [type, xs, ys, x2s, y2s, flagss, ...extra] = tokens;
    const result = createElement(type, parseInt(xs, 10), parseInt(ys, 10), parseInt(x2s, 10), parseInt(y2s, 10), parseInt(flagss, 10), extra);
    expect(result).not.toBeNull();
    return result!;
}

describe('dump()/parse() round-trip -- one case per Tier-1 element', () => {
    it('ResistorElm', () => {
        const r = new ResistorElm(0, 0, 100, 0, 0, 4700);
        const r2 = roundTrip(r) as ResistorElm;
        expect(r2.resistance).toBeCloseTo(4700);
    });

    it('CapacitorElm', () => {
        const c = new CapacitorElm(0, 0, 100, 0, 0, ['1e-6', '2.5', '10']);
        const c2 = roundTrip(c) as CapacitorElm;
        expect(c2.capacitance).toBeCloseTo(1e-6);
        expect(c2.initialVoltage).toBeCloseTo(2.5);
        expect(c2.seriesResistance).toBeCloseTo(10);
    });

    it('InductorElm', () => {
        const l = new InductorElm(0, 0, 100, 0, 0, ['0.5', '0.1', '2']);
        const l2 = roundTrip(l) as InductorElm;
        expect(l2.ind.inductance).toBeCloseTo(0.5);
        expect(l2.initialCurrent).toBeCloseTo(0.1);
        expect(l2.ind.saturationCurrent).toBeCloseTo(2);
    });

    it('VoltageElm (all waveform params)', () => {
        const v = new VoltageElm(0, 0, 100, 0, 0, ['1', '60', '12', '1', '0.5', '0.3']);
        const v2 = roundTrip(v) as VoltageElm;
        expect(v2.waveform).toBe(1);
        expect(v2.frequency).toBeCloseTo(60);
        expect(v2.maxVoltage).toBeCloseTo(12);
        expect(v2.bias).toBeCloseTo(1);
        expect(v2.phaseShift).toBeCloseTo(0.5);
        expect(v2.dutyCycle).toBeCloseTo(0.3);
    });

    it('RailElm inherits VoltageElm dump shape', () => {
        const rail = new RailElm(0, 0, 0, 0, 0, ['2', '50', '9']);
        const rail2 = roundTrip(rail) as RailElm;
        expect(rail2.getDumpType()).toBe('R');
        expect(rail2.waveform).toBe(2);
        expect(rail2.frequency).toBeCloseTo(50);
        expect(rail2.maxVoltage).toBeCloseTo(9);
    });

    it('ClockElm (no waveform token, fixed WF_SQUARE)', () => {
        const clk = new ClockElm(0, 0, 0, 0, 0, ['123', '3.3', '1.5', '0.2', '0.6']);
        const clk2 = roundTrip(clk) as ClockElm;
        expect(clk2.getDumpType()).toBe('164');
        expect(clk2.waveform).toBe(VoltageElm.WF_SQUARE);
        expect(clk2.frequency).toBeCloseTo(123);
        expect(clk2.maxVoltage).toBeCloseTo(3.3);
        expect(clk2.bias).toBeCloseTo(1.5);
        expect(clk2.phaseShift).toBeCloseTo(0.2);
        expect(clk2.dutyCycle).toBeCloseTo(0.6);
    });

    it('SwitchElm (position + momentary string-comparison quirk)', () => {
        const s = new SwitchElm(0, 0, 100, 0, 0, ['1', 'true']);
        expect(s.position).toBe(1);
        expect(s.momentary).toBe(true);
        const s2 = roundTrip(s) as SwitchElm;
        expect(s2.position).toBe(1);
        expect(s2.momentary).toBe(true);

        const s3 = new SwitchElm(0, 0, 100, 0, 0, ['0', 'false']);
        const s4 = roundTrip(s3) as SwitchElm;
        expect(s4.position).toBe(0);
        expect(s4.momentary).toBe(false);
    });

    it('Switch2Elm (link/throwCount appended after position/momentary)', () => {
        const s2 = new Switch2Elm(0, 0, 100, 0, 0, ['0', 'false', '5', '3']);
        const s2b = roundTrip(s2) as Switch2Elm;
        expect(s2b.position).toBe(0);
        expect(s2b.link).toBe(5);
        expect(s2b.throwCount).toBe(3);
    });

    it('DiodeElm (modelName token only present/read when FLAG_MODEL set)', () => {
        const plain = new DiodeElm(0, 0, 100, 0, 0);
        const plain2 = roundTrip(plain) as DiodeElm;
        expect(plain2.modelName).toBe('default');

        const named = new DiodeElm(0, 0, 100, 0, 2, ['custom-model']);
        expect(named.modelName).toBe('custom-model');
        const named2 = roundTrip(named) as DiodeElm;
        expect(named2.modelName).toBe('custom-model');
    });

    it('ZenerElm (always overwrites modelName/model regardless of params)', () => {
        const z = new ZenerElm(0, 0, 100, 0, 0);
        const z2 = roundTrip(z) as ZenerElm;
        expect(z2.getDumpType()).toBe('z');
        expect(z2.model.breakdownVoltage).toBeCloseTo(5.6);
    });

    it('LEDElm (RGB + brightness, no model flags set)', () => {
        const led = new LEDElm(0, 0, 100, 0, 0, ['0.2', '0.3', '0.4', '0.02']);
        const led2 = roundTrip(led) as LEDElm;
        expect(led2.colorR).toBeCloseTo(0.2);
        expect(led2.colorG).toBeCloseTo(0.3);
        expect(led2.colorB).toBeCloseTo(0.4);
        expect(led2.maxBrightnessCurrent).toBeCloseTo(0.02);
    });

    it('TransistorElm (beta must survive -- all 4 tokens emitted together)', () => {
        const t = new TransistorElm(0, 0, 100, 0, 0, ['1', '0.1', '0.2', '150']);
        const t2 = roundTrip(t) as TransistorElm;
        expect(t2.pnp).toBe(1);
        expect(t2.lastvbe).toBeCloseTo(0.1);
        expect(t2.lastvbc).toBeCloseTo(0.2);
        expect(t2.beta).toBeCloseTo(150);
    });

    it('MosfetElm (vt/beta tokens; pnp derived from flags, not a token)', () => {
        const m = new MosfetElm(0, 0, 100, 0, MosfetElm.FLAG_PNP, ['2', '0.05']);
        expect(m.pnp).toBe(-1);
        const m2 = roundTrip(m) as MosfetElm;
        expect(m2.vt).toBeCloseTo(2);
        expect(m2.beta).toBeCloseTo(0.05);
        expect(m2.pnp).toBe(-1);
    });

    it('AndGateElm (lastOutput round-trips via the 0/highVoltage encoding)', () => {
        const g = new AndGateElm(0, 0, 100, 0, 0, ['3', '5', '5']);
        expect(g.inputCount).toBe(3);
        expect(g.lastOutput).toBe(true);
        const g2 = roundTrip(g) as AndGateElm;
        expect(g2.inputCount).toBe(3);
        expect(g2.highVoltage).toBeCloseTo(5);
        expect(g2.lastOutput).toBe(true);

        const gOff = new AndGateElm(0, 0, 100, 0, 0, ['2', '0', '5']);
        expect(gOff.lastOutput).toBe(false);
        const gOff2 = roundTrip(gOff) as AndGateElm;
        expect(gOff2.lastOutput).toBe(false);
    });

    it('GroundElm (symbolType)', () => {
        const gnd = new GroundElm(0, 0, 0, 0, 0, ['2']);
        const gnd2 = roundTrip(gnd) as GroundElm;
        expect(gnd2.symbolType).toBe(2);
    });

    it('CurrentElm (currentValue + maxVoltage always emitted together)', () => {
        const i = new CurrentElm(0, 0, 100, 0, 0, ['0.05', '12']);
        const i2 = roundTrip(i) as CurrentElm;
        expect(i2.currentValue).toBeCloseTo(0.05);
        expect(i2.maxVoltage).toBeCloseTo(12);
    });

    it('AmmeterElm (meter + scale)', () => {
        const am = new AmmeterElm(0, 0, 100, 0, 0, ['1', '2']);
        const am2 = roundTrip(am) as AmmeterElm;
        expect(am2.meter).toBe(1);
        expect(am2.scale).toBe(2);
    });

    it('ProbeElm (meter + scale + resistance)', () => {
        const p = new ProbeElm(0, 0, 100, 0, 0, ['1', '0', '5000']);
        const p2 = roundTrip(p) as ProbeElm;
        expect(p2.meter).toBe(1);
        expect(p2.resistance).toBeCloseTo(5000);
    });

    it('OutputElm (scale)', () => {
        const o = new OutputElm(0, 0, 0, 0, 0, ['3']);
        const o2 = roundTrip(o) as OutputElm;
        expect(o2.scale).toBe(3);
    });

    it('LabeledNodeElm (text containing a space -- exercises escaping)', () => {
        const n = new LabeledNodeElm(0, 0, 0, 0, 0, ['bus one']);
        expect(n.text).toBe('bus one');
        const n2 = roundTrip(n) as LabeledNodeElm;
        expect(n2.text).toBe('bus one');
    });

    it('TextElm (text containing an embedded newline -- exercises escaping)', () => {
        const t = new TextElm(0, 0, 0, 0, 0, ['18']);
        t.text = 'line one\nline two';
        const t2 = roundTrip(t) as TextElm;
        expect(t2.size).toBe(18);
        expect(t2.text).toBe('line one\nline two');
    });

    it('BoxElm / WireElm (pure geometry, no extra tokens)', () => {
        const b = new BoxElm(0, 0, 50, 50, 0);
        const b2 = roundTrip(b) as BoxElm;
        expect(b2.getDumpType()).toBe('b');
        expect(b2.x2).toBe(50);
        expect(b2.y2).toBe(50);

        const w = new WireElm(0, 0, 100, 0);
        const w2 = roundTrip(w) as WireElm;
        expect(w2.getDumpType()).toBe('w');
    });

    it('LogicInputElm (hiV/loV read from the LAST two tokens)', () => {
        const li = new LogicInputElm(0, 0, 0, 0, 0, ['1', 'false', '3.3', '0.1']);
        const li2 = roundTrip(li) as LogicInputElm;
        expect(li2.position).toBe(1);
        expect(li2.hiV).toBeCloseTo(3.3);
        expect(li2.loV).toBeCloseTo(0.1);
    });

    it('LogicOutputElm (threshold)', () => {
        const lo = new LogicOutputElm(0, 0, 0, 0, 0, ['1.8']);
        const lo2 = roundTrip(lo) as LogicOutputElm;
        expect(lo2.threshold).toBeCloseTo(1.8);
    });

    it('InverterElm (slewRate + highVoltage)', () => {
        const inv = new InverterElm(0, 0, 100, 0, 0, ['0.8', '3.3']);
        const inv2 = roundTrip(inv) as InverterElm;
        expect(inv2.slewRate).toBeCloseTo(0.8);
        expect(inv2.highVoltage).toBeCloseTo(3.3);
    });

    it('OpAmpElm (no params -- everything flag-derived)', () => {
        const op = new OpAmpElm(0, 0, 100, 0, OpAmpElm.FLAG_LOWGAIN);
        const op2 = roundTrip(op) as OpAmpElm;
        expect(op2.getDumpType()).toBe('a');
        expect(op2.gain).toBeCloseTo(1000);
    });

    it('PotElm (maxResistance, position, sliderText with an embedded space)', () => {
        const pot = new PotElm(0, 0, 100, 0, 0, ['2200', '0.25', 'my slider']);
        expect(pot.sliderText).toBe('my slider');
        const pot2 = roundTrip(pot) as PotElm;
        expect(pot2.maxResistance).toBeCloseTo(2200);
        expect(pot2.position).toBeCloseTo(0.25);
        expect(pot2.sliderText).toBe('my slider');
    });
});

describe('CircuitEngine.dump() + CircuitParser -- whole-circuit round-trip', () => {
    it('a small rail/resistor/ground circuit solves identically after dump+reparse', () => {
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 9;
        const r = new ResistorElm(0, 0, 100, 0, 0, 3000);
        const gnd = new GroundElm(100, 0, 100, 0, 0);
        engine.elmList = [rail, r, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(r.current).toBeCloseTo(0.003, 3);

        const text = engine.dump();
        const engine2 = new CircuitEngine();
        new CircuitParser(engine2).parse(text);
        expect(engine2.elmList.length).toBe(3);
        for (let i = 0; i < 5; i++) engine2.stepOnce();
        const r2 = engine2.elmList.find(e => e instanceof ResistorElm) as ResistorElm;
        expect(r2.current).toBeCloseTo(0.003, 3);
        expect(r2.resistance).toBeCloseTo(3000);
    });

    it('dump()+reparse is stable on a second round-trip (idempotent)', () => {
        // Reuses the same valid rail/resistor/ground topology as the test
        // above (rather than a standalone VoltageElm with no return path to
        // ground) -- CircuitParser.parse() unconditionally calls setup() ->
        // analyzeAndStamp(), so the circuit must be non-singular for parsing
        // to succeed at all, regardless of what this test actually checks.
        const engine = new CircuitEngine();
        const rail = new RailElm(0, 0, 0, 0, 0, 0);
        rail.maxVoltage = 5;
        engine.elmList = [
            rail,
            new ResistorElm(0, 0, 100, 0, 0, 500),
            new GroundElm(100, 0, 100, 0, 0),
        ];
        const text1 = engine.dump();
        const engine2 = new CircuitEngine();
        new CircuitParser(engine2).parse(text1);
        const text2 = engine2.dump();
        expect(text2).toBe(text1);
    });
});
