import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { createElement } from '../src/core/factory';
import { ExtChipElm } from '../src/elements/ext_chip';
import { ResistorElm } from '../src/elements/resistor';
import { GroundElm } from '../src/elements/ground';
import { RailElm } from '../src/elements/voltage';
import { WireElm } from '../src/elements/wire';

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

    it('inputs on the south row, outputs on the north row, cspc2-spaced along x', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in,b:in,c:out', '1000000', '', '']);
        elm.preStamp();
        expect(elm.getPostCount()).toBe(3);
        expect(elm.pins).toEqual([
            { name: 'a', dir: 'in' },
            { name: 'b', dir: 'in' },
            { name: 'c', dir: 'out' },
        ]);

        const pA = elm.getPost(0)!, pB = elm.getPost(1)!, pC = elm.getPost(2)!;
        // both inputs on the south row (same y), spaced cspc2=160 apart in x
        expect(pB.y).toBe(pA.y);
        expect(pB.x).toBe(pA.x + 160);
        // output sits strictly north of (above) the inputs
        expect(pC.y).toBeLessThan(pA.y);
    });

    it('board footprint widens with pin count and stays near the real-board aspect ratio', () => {
        const small = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in', '1000000', '', '']);
        small.preStamp();
        const wide = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in,b:in,c:in,d:in,e:in,f:in', '1000000', '', '']);
        wide.preStamp();

        expect(wide.boardWidth).toBeGreaterThan(small.boardWidth);
        // boardHeight is grid-quantized (see ExtChipElm.GRID), so the aspect
        // ratio is no longer EXACTLY equal between sizes -- it is only as
        // close as half a grid cell allows. Being on-grid outweighs being
        // photographically exact: an off-grid south row is unwireable.
        for (const elm of [small, wide]) {
            const err = Math.abs(elm.boardWidth / elm.boardHeight - ExtChipElm.ASPECT);
            expect(err).toBeLessThan(0.2);
        }
    });

    // REGRESSION: _boardHeight used to be `boardWidth / ASPECT` verbatim, which
    // is a multiple of nothing (8 cols -> 472.32). Since core/node.ts merges
    // nodes on an EXACT `${x},${y}` string match and the app snaps wire ends to
    // the 16px grid, every SOUTH-row (input) post was permanently unreachable
    // by wire while the north row worked fine. Assert the invariant directly.
    it('every post lands on the 16px grid, for every pin count', () => {
        const grid = ExtChipElm.GRID;
        for (let n = 1; n <= 20; n++) {
            const spec = Array.from({ length: n }, (_, i) => `i${i}:in`)
                .concat(Array.from({ length: n }, (_, i) => `o${i}:out`))
                .join(',');
            // x,y themselves on-grid, as any placed element's would be
            const elm = new ExtChipElm(64, 128, 164, 128, 0, ['ws://x', spec, '1000000', '', '']);
            elm.preStamp();

            expect(elm.boardHeight % grid).toBe(0);
            expect(elm.boardWidth % grid).toBe(0);
            expect(elm.getPostCount()).toBe(2 * n);
            for (let j = 0; j < elm.getPostCount(); j++) {
                const p = elm.getPost(j)!;
                expect(p.x % grid, `post ${j} x off-grid at ${n} pins`).toBe(0);
                expect(p.y % grid, `post ${j} y off-grid at ${n} pins`).toBe(0);
            }
        }
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

    // THE regression test for the off-grid-post bug. The two tests above drive
    // the pins by placing the rail/resistor directly ON the post coordinates,
    // which works whether or not the post is on-grid -- so neither of them
    // could ever have caught it. This one goes through a WIRE whose endpoint
    // has been grid-snapped exactly the way canvas/draw.ts's snap() does,
    // which is the only path a real user has.
    it('a grid-snapped wire connects to an INPUT post and drives it', () => {
        const grid = ExtChipElm.GRID;
        const snap = (v: number) => Math.round(v / grid) * grid;

        const engine = new CircuitEngine();
        const elm = new ExtChipElm(64, 64, 164, 64, 0, ['ws://x', 'rst:in,led:out', '1000000', '', '']);
        elm.preStamp();
        const inPost = elm.getPost(0)!;

        // Snapping must be a no-op: if it is not, no wire can ever reach here.
        expect({ x: snap(inPost.x), y: snap(inPost.y) }).toEqual({ x: inPost.x, y: inPost.y });

        // Wire from the input post out to a rail 160px south, as if drawn.
        const farX = snap(inPost.x), farY = snap(inPost.y + 160);
        const wire = new WireElm(snap(inPost.x), snap(inPost.y), farX, farY);
        const rail = new RailElm(farX, farY, farX, farY, 0, 0);
        rail.maxVoltage = 3.3;
        const gnd = new GroundElm(1000, 1000, 1000, 1000, 0);

        engine.elmList = [elm, wire, rail, gnd];
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
