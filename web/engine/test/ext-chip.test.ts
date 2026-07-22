import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { createElement } from '../src/core/factory';
import { ExtChipElm } from '../src/elements/ext_chip';
import { ResistorElm } from '../src/elements/resistor';
import { GroundElm } from '../src/elements/ground';
import { RailElm } from '../src/elements/voltage';

describe('ExtChipElm registration + dump round-trip', () => {
    it('is registered under dump type "460" via the factory', () => {
        const elm = createElement('460', 0, 0, 100, 0, 0, []);
        expect(elm).toBeInstanceOf(ExtChipElm);
    });

    it('defaults: bridgeUrl/quantumNs/pinSpec/engineName/source', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0);
        expect(elm.bridgeUrl).toBe('ws://localhost:3100');
        expect(elm.pinSpec).toBe('');
        expect(elm.quantumNs).toBe(1_000_000);
        expect(elm.engineName).toBe('');
        expect(elm.source).toBe('');
        expect(elm.getPostCount()).toBe(0);
    });

    it('round-trips dumpTokens() -> constructor, including source with spaces/newlines', () => {
        const elm = new ExtChipElm(10, 20, 110, 20, 0, [
            'ws://localhost:3101',
            'rst:in,led:out',
            '2000000',
            'mainline',
            'module top(input rst, output led);\n  assign led = rst;\nendmodule',
        ]);
        const tokens = elm.dumpTokens().map(String);
        const reloaded = new ExtChipElm(10, 20, 110, 20, 0, tokens);

        expect(reloaded.bridgeUrl).toBe('ws://localhost:3101');
        expect(reloaded.pinSpec).toBe('rst:in,led:out');
        expect(reloaded.quantumNs).toBe(2_000_000);
        expect(reloaded.engineName).toBe('mainline');
        expect(reloaded.source).toBe(elm.source);
        expect(reloaded.source).toContain('\n');
        expect(reloaded.source).toContain(' ');
    });

    it('tolerates missing trailing tokens (no source token at all)', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in,b:out', '5000']);
        expect(elm.engineName).toBe('');
        expect(elm.source).toBe('');
        expect(elm.pins).toEqual([{ name: 'a', dir: 'in' }, { name: 'b', dir: 'out' }]);
    });

    it('full dump() line reloads through the factory unchanged', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://localhost:3100', 'x:in,y:out', '1000000', '', 'src with spaces']);
        const line = elm.dump();
        const tokens = line.trim().split(/\s+/);
        expect(tokens[0]).toBe('460');
        const reloaded = createElement('460', 0, 0, 100, 0, 0, tokens.slice(6));
        expect(reloaded).toBeInstanceOf(ExtChipElm);
        const re = reloaded as ExtChipElm;
        expect(re.pinSpec).toBe('x:in,y:out');
        expect(re.source).toBe('src with spaces');
    });
});

describe('ExtChipElm pin geometry', () => {
    it('empty/invalid pinSpec -> zero posts (inert block)', () => {
        const empty = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', '', '1000000', '', '']);
        expect(empty.getPostCount()).toBe(0);
        expect(empty.pins).toEqual([]);

        const invalid = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'bad-spec-no-colon', '1000000', '', '']);
        expect(invalid.getPostCount()).toBe(0);
    });

    it('inputs on the west side, outputs on the east side, cspc2-spaced', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in,b:in,c:out', '1000000', '', '']);
        elm.preStamp();
        expect(elm.getPostCount()).toBe(3);
        expect(elm.pins).toEqual([
            { name: 'a', dir: 'in' },
            { name: 'b', dir: 'in' },
            { name: 'c', dir: 'out' },
        ]);

        const pA = elm.getPost(0)!, pB = elm.getPost(1)!, pC = elm.getPost(2)!;
        // both inputs on the west side (same x as the chip origin)
        expect(pA.x).toBe(0);
        expect(pB.x).toBe(0);
        expect(pB.y).toBe(pA.y + 32);
        // output sits strictly east of the inputs
        expect(pC.x).toBeGreaterThan(pA.x);
    });

    it('setPinSpec() re-derives pins and stays preStamp-safe', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in', '1000000', '', '']);
        elm.preStamp();
        expect(elm.getPostCount()).toBe(1);

        elm.setPinSpec('p:in,q:in,r:out,s:out');
        expect(() => elm.preStamp()).not.toThrow();
        expect(elm.getPostCount()).toBe(4);
        expect(elm.pins.map((p) => p.name)).toEqual(['p', 'q', 'r', 's']);
    });
});

describe('ExtChipElm electrical behavior', () => {
    it('drives an output high (3.3V) through a resistor to ground when the outputBits bit is set', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'led:out', '1000000', '', '']);
        elm.preStamp();
        const outPost = elm.getPost(0)!;

        const r = new ResistorElm(outPost.x, outPost.y, outPost.x + 50, outPost.y, 0, ['1000']);
        const gnd = new GroundElm(outPost.x + 50, outPost.y, outPost.x + 50, outPost.y, 0);

        engine.elmList = [elm, r, gnd];
        engine.analyzeAndStamp();

        elm.outputBits = 1;
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeCloseTo(3.3, 1);

        elm.outputBits = 0;
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeCloseTo(0, 1);
    });

    it('inputBits reflects a rail-driven input pin above/below threshold after stepOnce', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'rst:in', '1000000', '', '']);
        elm.preStamp();
        const inPost = elm.getPost(0)!;

        const rail = new RailElm(inPost.x, inPost.y, inPost.x, inPost.y, 0, 0);
        rail.maxVoltage = 5;
        const gnd = new GroundElm(500, 500, 500, 500, 0);

        engine.elmList = [elm, rail, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(elm.inputBits & 1).toBe(1);

        rail.maxVoltage = 0;
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.inputBits & 1).toBe(0);
    });

    it('unconfigured (no pins) analyzes fine inside an unrelated circuit', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0); // default empty pinSpec

        const rail = new RailElm(200, 200, 200, 200, 0, 0);
        rail.maxVoltage = 5;
        const r = new ResistorElm(200, 200, 300, 200, 0, ['1000']);
        const gnd = new GroundElm(300, 200, 300, 200, 0);

        engine.elmList = [elm, rail, r, gnd];
        expect(() => engine.analyzeAndStamp()).not.toThrow();
        expect(() => engine.stepOnce()).not.toThrow();
    });
});
