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

    it('round-trips the clockHz/targetId tokens added after the Java original', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, [
            'ws://localhost:3101', 'a:in', '250000', 'mainline', 'src', '48000000', 'bluepill',
        ]);
        expect(elm.clockHz).toBe(48_000_000);
        expect(elm.targetId).toBe('bluepill');

        const reloaded = new ExtChipElm(0, 0, 100, 0, 0, elm.dumpTokens().map(String));
        expect(reloaded.clockHz).toBe(48_000_000);
        expect(reloaded.targetId).toBe('bluepill');
        // The whole-line path matters too: `source` is no longer the last
        // token, so anything that let whitespace survive escaping would now
        // desync tokens 6-7 rather than merely mangling the tail.
        const tokens = elm.dump().trim().split(/\s+/);
        const viaLine = createElement('460', 0, 0, 100, 0, 0, tokens.slice(6)) as ExtChipElm;
        expect(viaLine.clockHz).toBe(48_000_000);
        expect(viaLine.targetId).toBe('bluepill');
    });

    it('a pre-editor 5-token dump line still loads, picking up new defaults', () => {
        const legacy = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in', '1000000', '', 'src']);
        expect(legacy.clockHz).toBe(ExtChipElm.DEFAULT_CLOCK_HZ);
        expect(legacy.targetId).toBe('');
        expect(legacy.pinSpec).toBe('a:in');
    });

    it('tolerates missing trailing tokens (no source token at all)', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'a:in,b:out', '5000']);
        expect(elm.engineName).toBe('');
        expect(elm.source).toBe('');
        expect(elm.pins).toEqual([{ name: 'a', dir: 'in', pull: null }, { name: 'b', dir: 'out', pull: null }]);
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
            { name: 'a', dir: 'in', pull: null },
            { name: 'b', dir: 'in', pull: null },
            { name: 'c', dir: 'out', pull: null },
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

    it('parses pull options, and rejects malformed ones outright', () => {
        const ok = new ExtChipElm(0, 0, 100, 0, 0,
            ['ws://x', 'a:in:pu10k,b:in:pd4k7,c:in,d:out', '1000000', '', '']);
        expect(ok.pins).toEqual([
            { name: 'a', dir: 'in', pull: { dir: 'up', r: 10_000 } },
            { name: 'b', dir: 'in', pull: { dir: 'down', r: 4_700 } },
            { name: 'c', dir: 'in', pull: null },
            { name: 'd', dir: 'out', pull: null },
        ]);

        // A typo must fail loudly (zero posts, the existing "inert block"
        // contract) rather than being silently dropped -- a pull that quietly
        // vanishes turns into a button that mysteriously never works.
        for (const bad of ['a:in:xx10k', 'a:in:pu', 'a:in:pu0', 'a:in:puabc', 'a:out:pu10k']) {
            const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', bad, '1000000', '', '']);
            expect(elm.getPostCount(), `${bad} should not parse`).toBe(0);
        }
    });

    it('a pin spec with pull options survives a dump round trip', () => {
        const elm = new ExtChipElm(0, 0, 100, 0, 0,
            ['ws://x', 'btn:in:pu10k,led:out', '1000000', '', '']);
        const reloaded = new ExtChipElm(0, 0, 100, 0, 0, elm.dumpTokens().map(String));
        expect(reloaded.pinSpec).toBe('btn:in:pu10k,led:out');
        expect(reloaded.pins[0].pull).toEqual({ dir: 'up', r: 10_000 });
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
        // Not 3.3V exactly: the pin drives through OUTPUT_RESISTANCE, so this
        // is a divider. Real GPIO behaves the same way, and it is what stops
        // an LED wired straight to a pin from drawing unbounded current.
        const expected = 3.3 * 1000 / (1000 + ExtChipElm.OUTPUT_RESISTANCE);
        expect(elm.volts[0]).toBeCloseTo(expected, 2);

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

    // Without a pull, this circuit CANNOT WORK, and that is the bug: with the
    // switch open the input node is driven by nothing, so the Analyzer's
    // unconnected-node handling ties it to ground through 1e8 ohm and the pin
    // reads LOW whether or not the button is pressed. A real board uses a pull
    // resistor (the Tang Nano's own buttons have 10K pull-ups); so does this.
    it('a pull-up input plus a switch to ground reads HIGH open, LOW closed', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'btn:in:pu10k', '1000000', '', '']);
        elm.preStamp();
        const inPost = elm.getPost(0)!;

        // The "switch" is a resistor to ground: 1 ohm closed, 1e9 open.
        const sw = new ResistorElm(inPost.x, inPost.y, inPost.x + 64, inPost.y, 0, ['1e9']);
        const gnd = new GroundElm(inPost.x + 64, inPost.y, inPost.x + 64, inPost.y, 0);

        engine.elmList = [elm, sw, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeCloseTo(3.3, 1);
        expect(elm.inputBits & 1).toBe(1);      // not pressed -> HIGH

        sw.resistance = 1;
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeLessThan(0.1);
        expect(elm.inputBits & 1).toBe(0);      // pressed -> LOW
    });

    it('a pull-down input holds the pin at 0V when nothing drives it', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'sw:in:pd4k7', '1000000', '', '']);
        elm.preStamp();
        const inPost = elm.getPost(0)!;
        const gnd = new GroundElm(900, 900, 900, 900, 0);

        engine.elmList = [elm, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeCloseTo(0, 3);
        expect(elm.inputBits & 1).toBe(0);

        // A 3.3V rail through 1k beats the 4k7 pull-down.
        const rail = new RailElm(inPost.x, inPost.y - 64, inPost.x, inPost.y - 64, 0, 0);
        rail.maxVoltage = 3.3;
        const r = new ResistorElm(inPost.x, inPost.y - 64, inPost.x, inPost.y, 0, ['1000']);
        engine.elmList = [elm, r, rail, gnd];
        engine.analyzeAndStamp();
        for (let i = 0; i < 5; i++) engine.stepOnce();
        expect(elm.volts[0]).toBeGreaterThan(ExtChipElm.THRESHOLD);
        expect(elm.inputBits & 1).toBe(1);
    });

    // The single most common beginner circuit. As an ideal 0-ohm source this
    // asked the solver for unbounded current through the LED; with a real
    // driver impedance it gives the physical answer instead.
    it('an output driving a bare short delivers bounded current', () => {
        const engine = new CircuitEngine();
        const elm = new ExtChipElm(0, 0, 100, 0, 0, ['ws://x', 'led:out', '1000000', '', '']);
        elm.preStamp();
        const outPost = elm.getPost(0)!;

        const short = new ResistorElm(outPost.x, outPost.y, outPost.x + 64, outPost.y, 0, ['0.001']);
        const gnd = new GroundElm(outPost.x + 64, outPost.y, outPost.x + 64, outPost.y, 0);
        engine.elmList = [elm, short, gnd];
        engine.analyzeAndStamp();

        elm.outputBits = 1;
        for (let i = 0; i < 5; i++) engine.stepOnce();

        expect(elm.volts[0]).toBeLessThan(0.05);          // pulled down by the short
        const current = Math.abs(short.current);
        expect(current).toBeGreaterThan(0);
        // ~100 mA, the order of magnitude a real 3.3V pad delivers into a
        // short -- finite, and recognisably "too much" rather than nonsense.
        expect(current).toBeLessThan(0.2);
        expect(current).toBeCloseTo(3.3 / ExtChipElm.OUTPUT_RESISTANCE, 2);
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
