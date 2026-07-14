import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { ResistorElm } from '../src/elements/resistor';
import { GroundElm } from '../src/elements/ground';
import { VoltageElm } from '../src/elements/voltage';

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
});
