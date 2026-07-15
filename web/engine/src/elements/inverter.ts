import { CircuitElm, Stamper } from './base';
import { CircuitNode } from '../core/node';
import { GateElm } from './gate';

// Ported from InverterElm.java. Unlike the GateElm family this is a plain
// 2-post element (in, out) with a slew-rate-limited output instead of the
// oscillation-damping/propagation-delay logic GateElm uses.
export class InverterElm extends CircuitElm {
    slewRate: number; // V/ns
    highVoltage: number;
    lastOutputVoltage = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        this.slewRate = 0.5;
        this.highVoltage = 5;
        if (Array.isArray(params) && params.length > 0) {
            this.slewRate = parseFloat(params[0]) || 0.5;
            this.highVoltage = params.length > 1 ? (parseFloat(params[1]) || 5) : GateElm.lastHighVoltage;
        } else {
            // Matches the Java no-arg ctor: copy defaults from the last gate edited.
            this.highVoltage = GateElm.lastHighVoltage;
        }
    }

    getDumpType() { return 'I'; }
    dumpTokens() { return [this.slewRate, this.highVoltage]; }
    getPostCount() { return 2; }
    getVoltageSourceCount() { return 1; }
    setHighVoltage(hv: number) { this.highVoltage = hv; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource);
    }

    startIteration(stamper: Stamper) {
        this.lastOutputVoltage = this.volts[1];
    }

    doStep(stamper: Stamper) {
        let out = this.volts[0] > this.highVoltage * 0.5 ? 0 : this.highVoltage;
        const maxStep = this.slewRate * stamper.timeStep * 1e9;
        out = Math.max(Math.min(this.lastOutputVoltage + maxStep, out), this.lastOutputVoltage - maxStep);
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource, out);
    }

    getVoltageDiff() { return this.volts[0]; }
    getConnection(n1: number, n2: number) { return false; }
    hasGroundConnection(n1: number) { return n1 === 1; }
    getCurrentIntoNode(n: number) { return n === 1 ? this.current : 0; }
    // Java's validate() checks for a rail-node path via FindPathInfo; not yet
    // ported (same gap noted on CurrentElm/Switch2Elm) so we accept unconditionally.
    validate() { return true; }
}
