import { CircuitElm, Stamper } from './base';
import { SwitchElm } from './switch';
import { CircuitNode } from '../core/node';

// Ported from LogicInputElm.java. NOTE: real dump id is 'L', not 'i' ('i' is
// CurrentElm) — verified against LogicInputElm.java before writing this file.
export class LogicInputElm extends SwitchElm {
    static FLAG_TERNARY = 1;
    static FLAG_NUMERIC = 2;
    hiV = 5;
    loV = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        if (Array.isArray(params) && params.length > 2) {
            this.hiV = parseFloat(params[params.length - 2]) || 5;
            this.loV = parseFloat(params[params.length - 1]) || 0;
        } else {
            this.hiV = 5;
            this.loV = 0;
        }
        if (this.isTernary()) {
            this.posCount = 3;
        }
    }

    isTernary() { return (this.flags & LogicInputElm.FLAG_TERNARY) !== 0; }
    isNumeric() { return (this.flags & (LogicInputElm.FLAG_TERNARY | LogicInputElm.FLAG_NUMERIC)) !== 0; }
    getDumpType() { return 'L'; }
    getPostCount() { return 1; }
    getVoltageSourceCount() { return 1; }
    isWireEquivalent() { return false; }
    isRemovableWire() { return false; }
    hasGroundConnection(n1: number) { return true; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
    }

    doStep(stamper: Stamper) {
        let v = (this.position === 0) ? this.loV : this.hiV;
        if (this.isTernary()) {
            v = this.loV + this.position * (this.hiV - this.loV) * 0.5;
        }
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, v);
    }

    calculateCurrent() {}
    setCurrent(vs: unknown, c: number) { this.current = c; }
    validateRailNode(n: number) { return true; }
    validate() { return this.validateRailNode(0); }
}

// Ported from LogicOutputElm.java. NOTE: real dump id is 'M', not 'O' —
// verified against LogicOutputElm.java before writing this file.
export class LogicOutputElm extends CircuitElm {
    static FLAG_TERNARY = 1;
    static FLAG_NUMERIC = 2;
    static FLAG_PULLDOWN = 4;
    threshold = 2.5;
    value = "";

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.threshold = parseFloat(params[0]) || 2.5;
        } else {
            this.threshold = 2.5;
        }
    }

    getDumpType() { return 'M'; }
    getPostCount() { return 1; }
    isTernary() { return (this.flags & LogicOutputElm.FLAG_TERNARY) !== 0; }
    isNumeric() { return (this.flags & (LogicOutputElm.FLAG_TERNARY | LogicOutputElm.FLAG_NUMERIC)) !== 0; }
    needsPullDown() { return (this.flags & LogicOutputElm.FLAG_PULLDOWN) !== 0; }

    stamp(stamper: Stamper) {
        if (this.needsPullDown()) {
            stamper.stampResistor(this.nodes[0], CircuitNode.ground, 1e6);
        }
    }

    // Java recomputes `value` in draw(); we do it in calculateCurrent() since
    // that's called once per completed step regardless of whether the app has a
    // canvas/render loop.
    calculateCurrent() {
        let s = (this.volts[0] < this.threshold) ? "L" : "H";
        if (this.isTernary()) {
            if (this.volts[0] > this.threshold * 1.5) s = "2";
            else if (this.volts[0] > this.threshold * 0.5) s = "1";
            else s = "0";
        } else if (this.isNumeric()) {
            s = (this.volts[0] < this.threshold) ? "0" : "1";
        }
        this.value = s;
    }
}
