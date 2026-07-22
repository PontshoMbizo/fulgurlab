import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CircuitEngine } from '../src/core/engine';
import { CircuitParser } from '../src/core/parser';
import { parseXmlCircuit } from '../src/core/xmlParser';
import { ResistorElm } from '../src/elements/resistor';
import { CapacitorElm } from '../src/elements/capacitor';
import { InductorElm } from '../src/elements/inductor';
import { VoltageElm } from '../src/elements/voltage';
import { SwitchElm } from '../src/elements/switch';
import { WireElm } from '../src/elements/wire';

// Verifies the Java fork's XML dump format (XMLSerializer.java /
// XMLDeserializer.java) can be read back into this engine -- audit issue #1.
// auto-tests/capac.txt and auto-tests/lrc.txt are real files from the Java
// build's own test corpus (not hand-authored fixtures), so this doubles as a
// format sanity check: if xmlParser.ts's attribute-name assumptions were
// wrong, these would fail to load any elements at all.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readAutoTest(name: string): string {
    return readFileSync(path.join(ROOT, 'auto-tests', name), 'utf8');
}

describe('XML circuit import', () => {
    it('loads auto-tests/capac.txt (v, r, c, w -- all in the supported tag set)', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(readAutoTest('capac.txt'));

        // v, r, c, w: 4 supported elements. The rest of the file (<o> scope,
        // <adj>, <test>, two <scopedata> blocks) isn't modelled -- each of
        // those lines/blocks should show up as preserved content instead of
        // silently vanishing or crashing the parse.
        expect(engine.elmList.length).toBe(4);
        expect(engine.elmList.some((e) => e instanceof VoltageElm)).toBe(true);
        expect(engine.elmList.some((e) => e instanceof ResistorElm)).toBe(true);
        expect(engine.elmList.some((e) => e instanceof CapacitorElm)).toBe(true);
        expect(engine.elmList.some((e) => e instanceof WireElm)).toBe(true);
        expect(engine.preservedLines.length).toBeGreaterThan(0);

        // Root <cir ts="0.000005" .../> -- both timeStep and maxTimeStep pick
        // it up (matches Java's `sim.maxTimeStep = sim.timeStep = ...`).
        expect(engine.timeStep).toBeCloseTo(0.000005, 12);
        expect(engine.maxTimeStep).toBeCloseTo(0.000005, 12);
        expect(engine.minTimeStep).toBeCloseTo(5e-11, 20);
        expect(engine.voltageRange).toBe(5);

        // Fixed point: dump() -> reparse (now classic text, since dump()
        // never emits XML) -> dump() again must reproduce the same text,
        // including every preserved %xml/%/o line.
        const dump1 = engine.dump();
        const engine2 = new CircuitEngine();
        new CircuitParser(engine2).parse(dump1);
        const dump2 = engine2.dump();
        expect(dump2).toBe(dump1);
        expect(engine2.elmList.length).toBe(4);
        expect(engine2.preservedLines.length).toBe(engine.preservedLines.length);
    });

    it('loads auto-tests/lrc.txt (r, s, w, c, l, v -- all supported)', () => {
        const engine = new CircuitEngine();
        const parser = new CircuitParser(engine);
        parser.parse(readAutoTest('lrc.txt'));

        // r, s, w, c, l, v, r: 7 elements, all reconstructable.
        expect(engine.elmList.length).toBe(7);
        expect(engine.elmList.filter((e) => e instanceof ResistorElm).length).toBe(2);
        expect(engine.elmList.some((e) => e instanceof SwitchElm)).toBe(true);
        expect(engine.elmList.some((e) => e instanceof InductorElm)).toBe(true);
        expect(engine.preservedLines.length).toBeGreaterThan(0);

        expect(engine.timeStep).toBeCloseTo(0.000005, 12);
        expect(engine.voltageRange).toBe(5);

        const dump1 = engine.dump();
        const engine2 = new CircuitEngine();
        new CircuitParser(engine2).parse(dump1);
        expect(engine2.dump()).toBe(dump1);
        expect(engine2.elmList.length).toBe(7);
    });

    it('reconstructs a resistor element exactly from a synthetic XML string', () => {
        const xml = [
            '<cir f="1" ts="0.00001" ic="10" cb="50" pb="50" vr="5" mts="1e-10">',
            '  <r x="10 20 110 20" f="0" r="4700"/>',
            '</cir>',
        ].join('\n');

        const engine = new CircuitEngine();
        parseXmlCircuit(engine, xml);

        expect(engine.elmList.length).toBe(1);
        const r = engine.elmList[0];
        expect(r).toBeInstanceOf(ResistorElm);
        expect((r as ResistorElm).resistance).toBe(4700);
        expect(r.x).toBe(10);
        expect(r.y).toBe(20);
        expect(r.x2).toBe(110);
        expect(r.y2).toBe(20);
        expect(engine.timeStep).toBeCloseTo(0.00001, 12);
        expect(engine.maxTimeStep).toBeCloseTo(0.00001, 12);
        expect(engine.minTimeStep).toBeCloseTo(1e-10, 15);
    });

    it('preserves an unsupported XML tag verbatim (via a %xml comment line) and round-trips it', () => {
        const xml = [
            '<cir f="1" ts="0.00001" ic="10" cb="50" pb="50" vr="5" mts="1e-10">',
            '  <r x="10 20 110 20" f="0" r="1000"/>',
            '  <cc x="0 0 10 10" f="0" name="mysubcircuit"/>',
            '</cir>',
        ].join('\n');

        const engine = new CircuitEngine();
        parseXmlCircuit(engine, xml);

        expect(engine.elmList.length).toBe(1);
        expect(engine.preservedLines.length).toBe(1);
        expect(engine.preservedLines[0]).toContain('% xml');
        expect(engine.preservedLines[0]).toContain('cc');

        const dump1 = engine.dump();
        const engine2 = new CircuitEngine();
        new CircuitParser(engine2).parse(dump1);
        const dump2 = engine2.dump();
        expect(dump2).toBe(dump1);
        expect(engine2.preservedLines.length).toBe(1);
    });
});
