import { CircuitElm, Stamper, Point, interpPoint } from './base';
import { CircuitNode } from '../core/node';

// Ported from GateElm.java + the AND/OR/NAND/NOR/XOR/XNOR subclasses. Output
// pin (index `inputCount`) is driven via a ground-referenced voltage source,
// same as LogicInputElm/RailElm.
export class GateElm extends CircuitElm {
    static FLAG_SMALL = 1 << 0;
    static FLAG_SCHMITT = 1 << 1;
    static FLAG_INVERT_INPUTS = 1 << 2;

    inputCount = 2;
    lastOutput = false;
    highVoltage = 5;
    propagationDelay = 0; // seconds; 0 = instant (default)
    delayEndTime = 0;
    static lastHighVoltage = 5;
    static lastSchmitt = false;
    inputStates: boolean[] = [];
    oscillationCount = 0;
    lastTime = 0;
    gsize = 0;
    gwidth = 0;
    gwidth2 = 0;
    gheight = 0;
    inPosts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 0) {
            this.inputCount = parseInt(params[0]) || 2;
            const lastOutputVoltage = params.length > 1 ? parseFloat(params[1]) : 0;
            this.highVoltage = params.length > 2 ? parseFloat(params[2]) : 5;
            this.lastOutput = lastOutputVoltage > this.highVoltage * 0.5;
        } else {
            this.inputCount = 2;
            this.highVoltage = GateElm.lastHighVoltage;
        }
        if (this.inputCount < 1) this.inputCount = 2;
        this.inputStates = new Array(this.inputCount).fill(false);
        if (GateElm.lastSchmitt) {
            this.flags |= GateElm.FLAG_SCHMITT;
        }
        this.setSize((flags & GateElm.FLAG_SMALL) !== 0 ? 1 : 2);
    }

    setSize(s: number) {
        this.gsize = s;
        this.gwidth = 7 * s;
        this.gwidth2 = 14 * s;
        this.gheight = 8 * s;
        this.flags = (this.flags & ~GateElm.FLAG_SMALL) | (s === 1 ? GateElm.FLAG_SMALL : 0);
    }

    // Ported from GateElm.java setPoints(): inputs sit at fraction 0 (point1's
    // position along the line), spread perpendicular by multiples of gheight,
    // centered on the line (skipping offset 0 when inputCount is even).
    setPoints() {
        super.setPoints();
        let ww = this.gwidth2;
        if (ww > this.dn / 2) ww = this.dn / 2;
        if (this.isInverting() && ww + 8 > this.dn / 2) ww = this.dn / 2 - 8;
        this.calcLeads(ww * 2);
        const hs = this.gheight;
        this.inPosts = new Array(this.inputCount);
        let i0 = -Math.floor(this.inputCount / 2);
        for (let i = 0; i < this.inputCount; i++, i0++) {
            if (i0 === 0 && (this.inputCount & 1) === 0) i0++;
            this.inPosts[i] = interpPoint(this.point1, this.point2, 0, hs * i0);
        }
    }

    getPost(n: number): Point | null {
        if (n === this.inputCount) return this.point2;
        return this.inPosts[n] ?? null;
    }

    // Overridden per-gate (AND/OR/etc. are non-inverting; NAND/NOR/XNOR flip it).
    isInverting(): boolean { return false; }

    // Subclasses always override with their own numeric dump id; this fallback
    // exists only so the abstract base is instantiable-shaped like the Java one.
    getDumpType(): number | string { return this.getXmlDumpType(); }
    getXmlDumpType(): string { return "Gate"; }
    getPostCount() { return this.inputCount + 1; }
    getVoltageSourceCount() { return 1; }
    getConnection(n1: number, n2: number) { return false; }
    hasGroundConnection(n1: number) { return n1 === this.inputCount; }
    hasSchmittInputs() { return (this.flags & GateElm.FLAG_SCHMITT) !== 0; }

    getInput(x: number): boolean {
        const high = (this.flags & GateElm.FLAG_INVERT_INPUTS) === 0;
        if (!this.hasSchmittInputs()) {
            return (this.volts[x] > this.highVoltage * 0.5) ? high : !high;
        }
        const res = this.volts[x] > this.highVoltage * (this.inputStates[x] ? 0.35 : 0.55);
        this.inputStates[x] = res;
        return res ? high : !high;
    }

    // Overridden per-gate (calcFunction has no shared default).
    calcFunction(): boolean { return false; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[this.inputCount], this.voltSource);
    }

    doStep(stamper: Stamper) {
        let f = this.calcFunction();
        if (this.isInverting()) f = !f;

        if (this.propagationDelay === 0 && this.lastTime !== stamper.t) {
            if (this.lastOutput === !f) {
                if (this.oscillationCount++ > 50) {
                    this.oscillationCount = 0;
                    if (Math.random() > 0.5) f = this.lastOutput;
                }
            } else {
                this.oscillationCount = 0;
            }
            this.lastTime = stamper.t;
        }

        if (this.propagationDelay > 0) {
            if (f !== this.lastOutput) {
                if (this.delayEndTime === 0) {
                    this.delayEndTime = stamper.t + this.propagationDelay;
                } else if (stamper.t >= this.delayEndTime) {
                    this.lastOutput = f;
                    this.delayEndTime = 0;
                }
            } else {
                this.delayEndTime = 0;
            }
        } else {
            this.lastOutput = f;
        }

        const res = this.lastOutput ? this.highVoltage : 0;
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[this.inputCount], this.voltSource, res);
    }

    getCurrentIntoNode(n: number) {
        return n === this.inputCount ? this.current : 0;
    }

    validateRailNode(n: number) { return true; }
    validate() { return this.validateRailNode(this.inputCount); }
}

export class AndGateElm extends GateElm {
    isInverting() { return false; }
    getXmlDumpType() { return "And"; }
    getDumpType() { return "150"; }
    getGateName() { return "AND gate"; }
    calcFunction() {
        for (let i = 0; i < this.inputCount; i++) {
            if (!this.getInput(i)) return false;
        }
        return true;
    }
}

export class OrGateElm extends GateElm {
    isInverting() { return false; }
    getXmlDumpType() { return "Or"; }
    getDumpType() { return "152"; }
    getGateName() { return "OR gate"; }
    calcFunction() {
        for (let i = 0; i < this.inputCount; i++) {
            if (this.getInput(i)) return true;
        }
        return false;
    }
}

export class NandGateElm extends AndGateElm {
    isInverting() { return true; }
    getXmlDumpType() { return "Nand"; }
    getDumpType() { return "151"; }
    getGateName() { return "NAND gate"; }
}

export class NorGateElm extends OrGateElm {
    isInverting() { return true; }
    getXmlDumpType() { return "Nor"; }
    getDumpType() { return "153"; }
    getGateName() { return "NOR gate"; }
}

export class XorGateElm extends GateElm {
    isInverting() { return false; }
    getXmlDumpType() { return "Xor"; }
    getDumpType() { return "154"; }
    getGateName() { return "XOR gate"; }
    calcFunction() {
        let res = false;
        for (let i = 0; i < this.inputCount; i++) {
            if (this.getInput(i)) res = !res;
        }
        return res;
    }
}

// NOTE: real dump id is 431, not 155 (155 is DFlipFlopElm in the Java source) —
// this was wrong in an earlier draft of this port; verified against
// XnorGateElm.java before writing this file.
export class XnorGateElm extends XorGateElm {
    isInverting() { return true; }
    getXmlDumpType() { return "Xnor"; }
    getDumpType() { return "431"; }
    getGateName() { return "XNOR gate"; }
}
