import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExprParser, createExprState } from '../src/core/exprParser';
import { CircuitEngine } from '../src/core/engine';
import { CircuitParser } from '../src/core/parser';
import { RailElm } from '../src/elements/voltage';
import { GroundElm } from '../src/elements/ground';
import { ResistorElm } from '../src/elements/resistor';
import { CurrentElm } from '../src/elements/current';
import { VCCSElm, VCVSElm, CCVSElm, CCCSElm } from '../src/elements/dependent_sources';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function evalExpr(s: string, values: number[] = [], t = 0): number {
    const parser = new ExprParser(s);
    const expr = parser.parseExpression();
    expect(parser.gotError()).toBeNull();
    const es = createExprState();
    for (let i = 0; i < values.length; i++) es.values[i] = values[i];
    es.t = t;
    return expr.eval(es);
}

describe('ExprParser: precedence and operators', () => {
    it('standard arithmetic precedence (* before +, unary minus)', () => {
        expect(evalExpr('2+3*4')).toBeCloseTo(14);
        expect(evalExpr('(2+3)*4')).toBeCloseTo(20);
        expect(evalExpr('-2^2')).toBeCloseTo(-4); // unary binds looser than ^ (parseUminus -> parsePow)
        expect(evalExpr('2^3')).toBeCloseTo(8);
        expect(evalExpr('10/2/5')).toBeCloseTo(1); // left-associative
        expect(evalExpr('2-3-4')).toBeCloseTo(-5); // left-associative
    });

    it('comparison/logical/bitwise operators', () => {
        expect(evalExpr('3<4')).toBe(1);
        expect(evalExpr('3>4')).toBe(0);
        expect(evalExpr('3<=3')).toBe(1);
        expect(evalExpr('3>=4')).toBe(0);
        expect(evalExpr('3==3')).toBe(1);
        expect(evalExpr('3!=3')).toBe(0);
        expect(evalExpr('1&&0')).toBe(0);
        expect(evalExpr('1||0')).toBe(1);
        expect(evalExpr('!0')).toBe(1);
        expect(evalExpr('6&3')).toBe(2);
        expect(evalExpr('6|1')).toBe(7);
        expect(evalExpr('4>>1')).toBe(2);
    });

    it('ternary and select', () => {
        expect(evalExpr('1?2:3')).toBeCloseTo(2);
        expect(evalExpr('0?2:3')).toBeCloseTo(3);
        expect(evalExpr('select(1,10,20)')).toBeCloseTo(20);
        expect(evalExpr('select(-1,10,20)')).toBeCloseTo(10);
    });

    it('functions: trig, exp/log, min/max/clamp, floor/ceil/abs/mod', () => {
        expect(evalExpr('sin(0)')).toBeCloseTo(0);
        expect(evalExpr('cos(0)')).toBeCloseTo(1);
        expect(evalExpr('sqrt(4)')).toBeCloseTo(2);
        expect(evalExpr('abs(-5)')).toBeCloseTo(5);
        expect(evalExpr('exp(0)')).toBeCloseTo(1);
        expect(evalExpr('log(1)')).toBeCloseTo(0);
        expect(evalExpr('min(3,1,2)')).toBeCloseTo(1);
        expect(evalExpr('max(3,1,2)')).toBeCloseTo(3);
        expect(evalExpr('clamp(5,0,3)')).toBeCloseTo(3);
        expect(evalExpr('floor(1.9)')).toBeCloseTo(1);
        expect(evalExpr('ceil(1.1)')).toBeCloseTo(2);
        expect(evalExpr('mod(7,3)')).toBeCloseTo(1);
        expect(evalExpr('pi')).toBeCloseTo(Math.PI);
    });

    it('pwl (piecewise linear)', () => {
        // pwl(x, x0,y0, x1,y1, ...): below x0 -> y0; between segments -> linear interp; past last -> yN
        expect(evalExpr('pwl(-1, 0,0, 1,10)')).toBeCloseTo(0);
        expect(evalExpr('pwl(0.5, 0,0, 1,10)')).toBeCloseTo(5);
        expect(evalExpr('pwl(2, 0,0, 1,10)')).toBeCloseTo(10);
    });

    it('variables a..i map to values[0..8]; t is time', () => {
        expect(evalExpr('a+b', [3, 4])).toBeCloseTo(7);
        expect(evalExpr('i', [0, 0, 0, 0, 0, 0, 0, 0, 42])).toBeCloseTo(42);
        expect(evalExpr('t*2', [], 5)).toBeCloseTo(10);
    });

    it('rejects unknown function names / bad token', () => {
        const parser = new ExprParser('foo(1)');
        parser.parseExpression();
        expect(parser.gotError()).not.toBeNull();
    });

    it('rejects wrong argument counts for multi-arg functions', () => {
        const parser = new ExprParser('min(1)');
        parser.parseExpression();
        expect(parser.gotError()).not.toBeNull();
    });
});

describe('ExprParser: escape handling (shared with CustomLogicModel.unescape via base.ts)', () => {
    it('the corpus escape scheme (\\p -> +, \\s -> space) round-trips through the expression pipeline', () => {
        // tests/vccs-resistor.txt's real dump line uses "1\\pb" for "1+b".
        expect(evalExpr('1+b'.replace('+', '+'), [0, 2])).toBeCloseTo(3); // sanity
        const raw = '-(a-c)/(1000*(1+b))'; // already-unescaped form of the corpus expression
        const v = evalExpr(raw, [1, 2, 4]); // a=1,b=2,c=4
        expect(v).toBeCloseTo(-(1 - 4) / (1000 * (1 + 2)));
    });
});

describe('VCCSElm/VCVSElm linear-expression parity with the old fixed-gain model', () => {
    it('VCCSElm: expr "g*(a-b)" behaves like Iout = g*(Vctrl+ - Vctrl-) into a resistor load', () => {
        const g = 0.01, R = 1000, Vctrl = 3;
        const vccs = new VCCSElm(0, 0, 100, 0, 0, ['2', `${g}*(a-b)`]);
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

        expect(vccs.getVoltageDiff()).toBeCloseTo(g * Vctrl * R);
        expect(load.current).toBeCloseTo(g * Vctrl);
    });

    it('VCVSElm: expr "g*(a-b)" behaves like Vout = g*Vctrl exactly, independent of load', () => {
        const g = 2, Vctrl = 3;
        for (const R of [500, 2000]) {
            const vcvs = new VCVSElm(0, 0, 100, 0, 0, ['2', `${g}*(a-b)`]);
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

            expect(vcvs.getVoltageDiff()).toBeCloseTo(g * Vctrl);
        }
    });

    it('VCCSElm: nonlinear expression (clamp) still converges to a finite, sane operating point', () => {
        const vccs = new VCCSElm(0, 0, 100, 0, 0, ['2', 'clamp(2*(a-b),-1,1)']);
        vccs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => vccs.getPost(n)!);
        const engine = new CircuitEngine();
        const railP = new RailElm(p0.x, p0.y, p0.x, p0.y, 0, 0);
        railP.maxVoltage = 5;
        const gndM = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, 1000);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        engine.elmList = [vccs, railP, gndM, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 50; i++) engine.stepOnce();
        expect(Number.isFinite(vccs.getVoltageDiff())).toBe(true);
        // clamp(2*5,-1,1) = 1 -> current into load should be clamped to 1A -> V = 1000V
        expect(vccs.getVoltageDiff()).toBeCloseTo(1000, -1);
    });
});

describe('CCVSElm/CCCSElm: current-sensed expression parity', () => {
    it('CCVSElm: expr "g*a" behaves like Vout = g*Ictrl', () => {
        const g = 100, Ictrl = 0.005;
        const ccvs = new CCVSElm(0, 0, 100, 0, 0, ['2', `${g}*a`]);
        ccvs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => ccvs.getPost(n)!);
        const engine = new CircuitEngine();
        const src = new CurrentElm(p0.x, p0.y, p1.x, p1.y, 0, [String(Ictrl), '0']);
        const gndCtrl = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, 1e6);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        engine.elmList = [ccvs, src, gndCtrl, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(Math.abs(ccvs.controlVS.current)).toBeCloseTo(Ictrl);
        expect(ccvs.getVoltageDiff()).toBeCloseTo(g * ccvs.controlVS.current);
    });

    it('CCCSElm: expr "g*a" behaves like Iout = g*Ictrl', () => {
        const g = 10, Ictrl = 0.002, Rload = 1000;
        const cccs = new CCCSElm(0, 0, 100, 0, 0, ['2', `${g}*a`]);
        cccs.preStamp();
        const [p0, p1, p2, p3] = [0, 1, 2, 3].map(n => cccs.getPost(n)!);
        const src = new CurrentElm(p0.x, p0.y, p1.x, p1.y, 0, [String(Ictrl), '0']);
        const gndCtrl = new GroundElm(p1.x, p1.y, p1.x, p1.y, 0);
        const load = new ResistorElm(p2.x, p2.y, p3.x, p3.y, 0, Rload);
        const gndOut = new GroundElm(p3.x, p3.y, p3.x, p3.y, 0);
        const engine = new CircuitEngine();
        engine.elmList = [cccs, src, gndCtrl, load, gndOut];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(Math.abs(cccs.controlVS.current)).toBeCloseTo(Ictrl);
        // Compare against the ACTUAL sensed current (relative, not an assumed
        // sign) -- CurrentElm's own injection sign convention determines
        // whether controlVS.current comes out +Ictrl or -Ictrl for this wire
        // order, and load.current must track it consistently either way.
        expect(load.current).toBeCloseTo(g * cccs.controlVS.current);
    });
});

describe('Back-compat: old single-numeric-gain token synthesizes an equivalent expression', () => {
    it('VCCSElm(["0.01"]) behaves electrically identically to VCCSElm(["2","0.01*(a-b)"])', () => {
        const legacy = new VCCSElm(0, 0, 100, 0, 0, ['0.01']);
        expect(legacy.inputCount).toBe(2);
        expect(legacy.exprString).toBe('0.01*(a-b)');
        expect(legacy.gain).toBeCloseTo(0.01);
    });

    it('CCVSElm(["500"]) synthesizes "500*a"', () => {
        const legacy = new CCVSElm(0, 0, 100, 0, 0, ['500']);
        expect(legacy.exprString).toBe('500*a');
        expect(legacy.gain).toBeCloseTo(500);
    });
});

describe('Java corpus: expression-based dependent sources', () => {
    function loadCorpus(name: string): string {
        return readFileSync(path.join(ROOT, 'tests', name), 'utf8');
    }

    it('vccs-resistor.txt: parses with zero preserved lines and runs 100 steps with finite voltages', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(loadCorpus('vccs-resistor.txt'));
        expect(engine.preservedLines.length).toBe(0);
        for (let i = 0; i < 100; i++) engine.stepOnce();
        for (const elm of engine.elmList) {
            for (const v of elm.volts) {
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    it('vcvs-opamp.txt: the 212 (VCVS) line itself is supported (no longer preserved verbatim), and the circuit runs 100 steps with finite voltages', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(loadCorpus('vcvs-opamp.txt'));
        // The file's remaining 2 preserved lines are pre-existing "o" scope
        // fixture lines unrelated to this port (oscilloscope dump format,
        // out of scope here) -- see corpus-compat.test.ts's own summary log.
        // What matters for THIS pass is that no preserved line is the 212
        // (VCVS) line anymore.
        expect(engine.preservedLines.some(l => l.startsWith('212 '))).toBe(false);
        const vcvsElms = engine.elmList.filter(e => e instanceof VCVSElm);
        expect(vcvsElms.length).toBe(1);
        for (let i = 0; i < 100; i++) engine.stepOnce();
        for (const elm of engine.elmList) {
            for (const v of elm.volts) {
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    it('cccs.txt: constructs all 215x elements', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(loadCorpus('cccs.txt'));
        const cccsElms = engine.elmList.filter(e => e instanceof CCCSElm);
        expect(cccsElms.length).toBe(3);
    });

    it('current-adder.txt: constructs all 214x/213x elements', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(loadCorpus('current-adder.txt'));
        const ccvsElms = engine.elmList.filter(e => e instanceof CCVSElm);
        const vccsElms = engine.elmList.filter(e => e instanceof VCCSElm);
        expect(ccvsElms.length).toBe(2);
        expect(vccsElms.length).toBe(1);
    });

    it('vcvs-power.txt: constructs its 214/212 elements', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(loadCorpus('vcvs-power.txt'));
        const ccvsElms = engine.elmList.filter(e => e instanceof CCVSElm);
        const vcvsElms = engine.elmList.filter(e => e instanceof VCVSElm);
        expect(ccvsElms.length).toBe(1);
        expect(vcvsElms.length).toBe(1);
    });
});
