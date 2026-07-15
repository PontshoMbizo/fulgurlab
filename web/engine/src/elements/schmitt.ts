import { CircuitElm, Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from InvertingSchmittElm.java/SchmittElm.java ("contributed by
// Edward Calver"). A 2-post Schmitt trigger: post0 (input) has NO current
// path at all (high-impedance input, matches getConnection()->false below);
// post1 (output) is a voltage source referenced directly to GROUND (not to
// post0) -- same "last post is the output, never literally grounded in
// practice" pattern OpAmpElm already relies on, so no setVoltageSource()
// override is needed here either (byte-faithful: Java's own class doesn't
// add one).
//
// SchmittElm extends this class in Java and only changes two things: the
// output polarity (non-inverting instead of inverting) and WHEN the
// slew-rate-limiting reference voltage is captured -- InvertingSchmittElm
// re-reads volts[1] fresh on every doStep() sub-iteration, while SchmittElm
// captures it ONCE per real timestep via startIteration(). This is a real,
// deliberate behavioral difference in the oracle (not an inconsistency to
// "fix"), preserved faithfully.
export class InvertingSchmittElm extends CircuitElm {
    slewRate = 0.5; // V/ns
    lowerTrigger = 1.66;
    upperTrigger = 3.33;
    state = false;
    logicOnLevel = 5;
    logicOffLevel = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 4) {
            this.slewRate = parseFloat(params[0]);
            this.lowerTrigger = parseFloat(params[1]);
            this.upperTrigger = parseFloat(params[2]);
            this.logicOnLevel = parseFloat(params[3]);
            this.logicOffLevel = parseFloat(params[4]);
        }
    }

    getDumpType() { return 183; }
    dumpTokens(): (string | number | boolean)[] {
        return [this.slewRate, this.lowerTrigger, this.upperTrigger, this.logicOnLevel, this.logicOffLevel];
    }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource);
    }

    doStep(stamper: Stamper) {
        const v0 = this.volts[1];
        let out: number;
        if (this.state) {
            // Output is high
            if (this.volts[0] > this.upperTrigger) {
                this.state = false;
                out = this.logicOffLevel;
            } else {
                out = this.logicOnLevel;
            }
        } else {
            // Output is low
            if (this.volts[0] < this.lowerTrigger) {
                this.state = true;
                out = this.logicOnLevel;
            } else {
                out = this.logicOffLevel;
            }
        }
        const maxStep = this.slewRate * stamper.timeStep * 1e9;
        out = Math.max(Math.min(v0 + maxStep, out), v0 - maxStep);
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource, out);
    }

    getVoltageDiff() { return this.volts[0]; }

    // There is no current path through the input, but there is an indirect
    // path through the output to ground.
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(n1: number) { return n1 === 1; }

    getCurrentIntoNode(n: number) {
        if (n === 1) return this.current;
        return 0;
    }
}

// Non-inverting Schmitt trigger -- same hysteresis comparator, output
// polarity flipped, and lastOutputVoltage captured once per real step
// (startIteration()) rather than re-read every sub-iteration.
export class SchmittElm extends InvertingSchmittElm {
    lastOutputVoltage = 0;

    getDumpType() { return 182; }

    startIteration(_stamper: Stamper) {
        this.lastOutputVoltage = this.volts[1];
    }

    doStep(stamper: Stamper) {
        let out: number;
        if (this.state) {
            // Output is high
            if (this.volts[0] > this.upperTrigger) {
                this.state = false;
                out = this.logicOnLevel;
            } else {
                out = this.logicOffLevel;
            }
        } else {
            // Output is low
            if (this.volts[0] < this.lowerTrigger) {
                this.state = true;
                out = this.logicOffLevel;
            } else {
                out = this.logicOnLevel;
            }
        }
        const maxStep = this.slewRate * stamper.timeStep * 1e9;
        out = Math.max(Math.min(this.lastOutputVoltage + maxStep, out), this.lastOutputVoltage - maxStep);
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource, out);
    }
}
