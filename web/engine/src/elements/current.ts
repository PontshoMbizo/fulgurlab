import { CircuitElm, Stamper } from './base';

// Ported from CurrentElm.java. This fork's CurrentElm is not the plain ideal
// current source from upstream circuitjs1 — it has an added "Max Voltage"
// compliance limit (0 = unlimited) modelled as a smooth tanh saturation
// (Norton companion: parallel resistor + adjusted current source), which is
// what makes it nonlinear when maxVoltage > 0.
//
// SIMPLIFICATION (documented, not silently dropped): Java's validate()/
// setBroken() detects when the source has no DC path (via FindPathInfo graph
// search) and falls back to a 1e8 ohm resistor to avoid a singular matrix. The
// TS Analyzer doesn't have that path-finding yet (same gap as Switch2Elm), so
// `broken` is always false here — a current source into an open circuit will
// produce a singular-matrix error instead of gracefully degrading. Revisit
// once FindPathInfo-equivalent reachability lands in core/node.ts's Analyzer.
export class CurrentElm extends CircuitElm {
    currentValue: number;
    maxVoltage: number;
    lastVoltDiff = 0;
    broken = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 1) {
            this.currentValue = parseFloat(params[0]) || 0;
            this.maxVoltage = parseFloat(params[1]) || 0;
        } else {
            this.currentValue = 0.01;
            this.maxVoltage = 0;
        }
        if (this.currentValue === 0) this.currentValue = 0.01;
    }

    isVoltageLimited() { return this.maxVoltage > 0; }
    nonLinear() { return this.isVoltageLimited(); }

    reset() {
        super.reset();
        this.lastVoltDiff = 0;
    }

    getDumpType(): number | string { return 'i'; }
    // Both must always be emitted together: the constructor only reads
    // either when `params.length > 1`.
    dumpTokens(): (string | number | boolean)[] { return [this.currentValue, this.maxVoltage]; }

    stamp(stamper: Stamper) {
        if (this.broken) {
            // No current path; stamping an ideal current source would error.
            stamper.stampResistor(this.nodes[0], this.nodes[1], 1e8);
            this.current = 0;
        } else if (this.isVoltageLimited()) {
            stamper.stampNonLinear(this.nodes[0]);
            stamper.stampNonLinear(this.nodes[1]);
        } else {
            stamper.stampCurrentSource(this.nodes[0], this.nodes[1], this.currentValue);
            this.current = this.currentValue;
        }
    }

    // Smooth voltage compliance via tanh-shaped saturation, centered at
    // 0.975*maxVoltage with a step-size limiter so Newton iteration can't jump
    // clean across the transition band in one step.
    doStep(stamper: Stamper) {
        if (this.broken || !this.isVoltageLimited()) return;

        let vd = this.volts[1] - this.volts[0];
        const vStart = 0.95 * this.maxVoltage;
        const vWidth = this.maxVoltage - vStart;
        const vMid = (vStart + this.maxVoltage) / 2.0;
        const vt = Math.max(vWidth / 5.0, 1e-3);

        if (this.lastVoltDiff < vStart && vd > vStart) {
            vd = vStart;
            stamper.converged = false;
        } else if (this.lastVoltDiff > this.maxVoltage && vd < this.maxVoltage) {
            vd = this.maxVoltage;
            stamper.converged = false;
        } else if (this.lastVoltDiff >= vStart && this.lastVoltDiff <= this.maxVoltage) {
            const maxStep = Math.max(vWidth / 4.0, 0.01);
            if (vd > this.lastVoltDiff + maxStep) {
                vd = this.lastVoltDiff + maxStep;
                stamper.converged = false;
            } else if (vd < this.lastVoltDiff - maxStep) {
                vd = this.lastVoltDiff - maxStep;
                stamper.converged = false;
            }
        }
        this.lastVoltDiff = vd;

        const arg = (vd - vMid) / vt;
        const tanhArg = Math.tanh(arg);
        const i = this.currentValue * 0.5 * (1.0 - tanhArg);
        const sech2 = 1.0 - tanhArg * tanhArg;
        const g = -this.currentValue * 0.5 * sech2 / vt * vd;

        const absG = Math.abs(g) + 1e-6;
        stamper.stampResistor(this.nodes[0], this.nodes[1], 1.0 / absG);
        stamper.stampCurrentSource(this.nodes[0], this.nodes[1], i - g * vd);
        this.current = i;
    }

    getVoltageDiff() { return this.volts[1] - this.volts[0]; }
    getPower() { return -this.getVoltageDiff() * this.current; }

    // See file-level note: always reachable until FindPathInfo is ported.
    validate() { return true; }
}
