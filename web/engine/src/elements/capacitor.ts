import { CircuitElm, Stamper } from './base';

// Ported from CapacitorElm.java. Trapezoidal (default) or backward-Euler
// companion model selected by FLAG_BACK_EULER; optional series resistance adds
// an internal node (matches Java's getInternalNodeCount()).
export class CapacitorElm extends CircuitElm {
    static FLAG_BACK_EULER = 2;
    static FLAG_RESISTANCE = 4;

    capacitance: number;
    compResistance = 0;
    voltdiff = 0;
    seriesResistance = 0;
    initialVoltage: number;
    capNode2 = 1; // 1 = no series resistance, 2 = internal node when there is one
    curSourceValue = 0;
    curcount = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.capacitance = parseFloat(params[0]) || 1e-5;
            this.initialVoltage = params.length > 1 ? parseFloat(params[1]) : 1e-3;
            this.seriesResistance = params.length > 2 ? parseFloat(params[2]) : 0;
        } else if (typeof params === 'number') {
            this.capacitance = params;
            this.initialVoltage = 1e-3;
            this.seriesResistance = 0;
        } else {
            this.capacitance = 1e-5;
            this.initialVoltage = 1e-3;
            this.seriesResistance = 0;
        }
        this.voltdiff = this.initialVoltage;
        if (this.seriesResistance > 0) {
            this.flags |= CapacitorElm.FLAG_RESISTANCE;
        }
    }

    getDumpType(): number | string { return 'c'; }
    dumpTokens(): (string | number | boolean)[] { return [this.capacitance, this.initialVoltage, this.seriesResistance]; }
    isTrapezoidal() { return (this.flags & CapacitorElm.FLAG_BACK_EULER) === 0; }
    getInternalNodeCount() { return (this.seriesResistance > 0) ? 1 : 0; }

    reset() {
        super.reset();
        this.current = this.curcount = this.curSourceValue = 0;
        this.voltdiff = this.initialVoltage;
    }

    shorted() {
        super.reset();
        this.voltdiff = this.current = this.curcount = this.curSourceValue = 0;
    }

    stamp(stamper: Stamper) {
        this.capNode2 = (this.seriesResistance > 0) ? 2 : 1;
        if (this.isTrapezoidal()) {
            this.compResistance = stamper.timeStep / (2 * this.capacitance);
        } else {
            this.compResistance = stamper.timeStep / this.capacitance;
        }
        stamper.stampResistor(this.nodes[0], this.nodes[this.capNode2], this.compResistance);
        stamper.stampRightSide(this.nodes[0], 0);
        stamper.stampRightSide(this.nodes[this.capNode2], 0);
        if (this.seriesResistance > 0) {
            stamper.stampResistor(this.nodes[1], this.nodes[2], this.seriesResistance);
        }
    }

    startIteration(stamper: Stamper) {
        if (this.isTrapezoidal()) {
            this.curSourceValue = -this.voltdiff / this.compResistance - this.current;
        } else {
            this.curSourceValue = -this.voltdiff / this.compResistance;
        }
    }

    doStep(stamper: Stamper) {
        stamper.stampCurrentSource(this.nodes[0], this.nodes[this.capNode2], this.curSourceValue);
    }

    stepFinished(stamper: Stamper) {
        this.voltdiff = this.volts[0] - this.volts[this.capNode2];
        this.calculateCurrent();
    }

    calculateCurrent() {
        const voltdiff = this.volts[0] - this.volts[this.capNode2];
        if (this.compResistance > 0) {
            this.current = voltdiff / this.compResistance + this.curSourceValue;
        }
    }
}
