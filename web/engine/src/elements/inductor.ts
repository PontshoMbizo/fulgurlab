import { CircuitElm, Stamper } from './base';
import { CircuitNode } from '../core/node';

// Ported from Inductor.java (the embeddable companion-model helper) — used
// standalone here as InductorElm, matching how Java's InductorElm wraps it.
// Trapezoidal/backward-Euler selected by FLAG_BACK_EULER; optional saturation
// current makes the effective inductance (and therefore the element) nonlinear.
export class Inductor {
    static FLAG_BACK_EULER = 2;

    nodes: CircuitNode[] = [];
    flags = 0;
    inductance = 0;
    compResistance = 0;
    current = 0;
    curSourceValue = 0;
    saturationCurrent = 0;

    setup(ic: number, cr: number, f: number, isat: number = 0) {
        this.inductance = ic;
        this.current = cr;
        this.flags = f;
        this.saturationCurrent = isat;
    }

    isTrapezoidal() { return (this.flags & Inductor.FLAG_BACK_EULER) === 0; }
    reset() { this.resetTo(0); }
    resetTo(c: number) { this.curSourceValue = this.current = c; }

    calcEffectiveInductance(i: number): number {
        if (this.saturationCurrent <= 0) return this.inductance;
        const ratio = i / this.saturationCurrent;
        return this.inductance / (1 + ratio * ratio);
    }

    stamp(stamper: Stamper, n0: CircuitNode, n1: CircuitNode) {
        this.nodes[0] = n0;
        this.nodes[1] = n1;
        if (this.saturationCurrent <= 0) {
            if (this.isTrapezoidal()) {
                this.compResistance = 2 * this.inductance / stamper.timeStep;
            } else {
                this.compResistance = this.inductance / stamper.timeStep;
            }
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.compResistance);
        }
        // else: nonlinear — conductance is stamped fresh in doStep() every iteration.
        stamper.stampRightSide(this.nodes[0], 0);
        stamper.stampRightSide(this.nodes[1], 0);
    }

    nonLinear() { return this.saturationCurrent > 0; }

    startIteration(stamper: Stamper, voltdiff: number) {
        if (this.saturationCurrent > 0) {
            const lEff = this.calcEffectiveInductance(this.current);
            if (this.isTrapezoidal()) {
                this.compResistance = 2 * lEff / stamper.timeStep;
            } else {
                this.compResistance = lEff / stamper.timeStep;
            }
        }
        if (this.isTrapezoidal()) {
            this.curSourceValue = voltdiff / this.compResistance + this.current;
        } else {
            this.curSourceValue = this.current;
        }
    }

    calculateCurrent(voltdiff: number): number {
        if (this.compResistance > 0) {
            this.current = voltdiff / this.compResistance + this.curSourceValue;
        }
        return this.current;
    }

    doStep(stamper: Stamper, voltdiff: number) {
        if (this.saturationCurrent > 0) {
            stamper.stampConductance(this.nodes[0], this.nodes[1], 1.0 / this.compResistance);
        }
        stamper.stampCurrentSource(this.nodes[0], this.nodes[1], this.curSourceValue);
    }
}

export class InductorElm extends CircuitElm {
    ind: Inductor;
    initialCurrent = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        this.ind = new Inductor();
        let inductance = 1;
        let saturationCurrent = 0;
        if (Array.isArray(params) && params.length > 0) {
            inductance = parseFloat(params[0]) || 1;
            this.initialCurrent = params.length > 1 ? parseFloat(params[1]) : 0;
            saturationCurrent = params.length > 2 ? parseFloat(params[2]) : 0;
        } else if (typeof params === 'number') {
            inductance = params;
            this.initialCurrent = 0;
        } else {
            this.initialCurrent = 0;
        }
        this.ind.setup(inductance, this.current, flags, saturationCurrent);
    }

    getDumpType() { return 'l'; }

    reset() {
        super.reset();
        this.volts[0] = this.volts[1] = 0;
        this.current = this.initialCurrent;
        this.ind.resetTo(this.initialCurrent);
    }

    stamp(stamper: Stamper) {
        this.ind.stamp(stamper, this.nodes[0], this.nodes[1]);
    }

    startIteration(stamper: Stamper) {
        this.ind.startIteration(stamper, this.volts[0] - this.volts[1]);
    }

    nonLinear() { return this.ind.nonLinear(); }

    calculateCurrent() {
        this.current = this.ind.calculateCurrent(this.volts[0] - this.volts[1]);
    }

    doStep(stamper: Stamper) {
        this.ind.doStep(stamper, this.volts[0] - this.volts[1]);
    }
}
