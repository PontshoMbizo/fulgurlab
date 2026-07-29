import { CircuitElm, Stamper, Point, interpPoint } from './base';
import { Diode, DiodeElm, DEFAULT_DIODE_MODEL } from './diode';
import { VoltageSource } from '../core/node';
import { MosfetElm } from './mosfet';

// Three-plus-terminal semiconductors that are not already covered by
// transistor.ts/mosfet.ts: the JFET, the vacuum triode, and the three
// thyristor-family devices (SCR, diac, triac).
//
// The thyristors all share one modelling idea: a latching internal state
// variable flipped in startIteration() from the previous step's currents, and
// a resistor whose value is chosen from that state in doStep(). They are
// nonlinear because of the embedded diodes, not because of the latch.

// ---------------------------------------------------------------------- JFET

// A MosfetElm with a gate-junction diode and JFET default parameters (values
// from Hayes & Horowitz p155, same as Java's).
export class JfetElm extends MosfetElm {
    diode = new Diode();
    gateCurrent = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.noDiagonal = true;
        this.diode.setup(DEFAULT_DIODE_MODEL);
    }

    getDumpType() { return 'j'; }
    getDefaultThreshold() { return -4; }
    getDefaultBeta() { return 0.00125; }
    showBulk() { return false; }

    reset(): void {
        super.reset();
        this.diode.reset();
    }

    stamp(stamper: Stamper): void {
        super.stamp(stamper);
        if (this.pnp < 0) this.diode.stamp(stamper, this.nodes[1], this.nodes[0]);
        else this.diode.stamp(stamper, this.nodes[0], this.nodes[1]);
    }

    doStep(stamper: Stamper): void {
        super.doStep(stamper);
        this.diode.doStep(stamper, this.pnp * (this.volts[0] - this.volts[1]));
    }

    calculateCurrent(): void {
        this.gateCurrent = this.pnp * this.diode.calculateCurrent(this.pnp * (this.volts[0] - this.volts[1]));
    }

    getCurrentIntoNode(n: number): number {
        if (n === 0) return -this.gateCurrent;
        if (n === 1) return this.gateCurrent + this.ids;
        return -this.ids;
    }
}

// -------------------------------------------------------------------- Triode

// Child-Langmuir vacuum triode: ids = (vgk + vpk/mu)^1.5 / kg1, linearized
// into a gm/Gds pair each Newton iteration. Post order is
// 0 = plate, 1 = grid, 2 = cathode.
export class TriodeElm extends CircuitElm {
    static FLAG_FLIP = 1;
    static FLAG_DSIGN_FIX = 2;
    static gridCurrentR = 6000;

    static plateN = 0;
    static gridN = 1;
    static cathN = 2;

    mu = 93;
    kg1 = 680;
    currentp = 0;
    currentg = 0;
    currentc = 0;
    private lastv0 = 0;
    private lastv1 = 0;
    private lastv2 = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 2) {
            this.mu = parseFloat(params[0]);
            this.kg1 = parseFloat(params[1]);
        } else {
            this.flags |= TriodeElm.FLAG_DSIGN_FIX;
        }
        this.noDiagonal = true;
    }

    getDumpType() { return 173; }
    dumpTokens() { return [this.mu, this.kg1]; }
    getPostCount() { return 3; }
    nonLinear() { return true; }

    reset(): void {
        this.volts[0] = this.volts[1] = this.volts[2] = 0;
        this.lastv0 = this.lastv1 = this.lastv2 = 0;
    }

    // Plate at point1, grid offset perpendicular, cathode at point2 — the
    // electrically meaningful part of Java's setPoints() (the rest is the
    // envelope/filament drawing geometry).
    setPoints(): void {
        super.setPoints();
        const s = ((this.flags & TriodeElm.FLAG_DSIGN_FIX) !== 0) ? this.dsign : 1;
        const sign = (this.flags & TriodeElm.FLAG_FLIP) !== 0 ? -s : s;
        this.platePoint = interpPoint(this.point1, this.point2, 0, 16 * sign);
        this.gridPoint = this.point1;
        this.cathodePoint = interpPoint(this.point1, this.point2, 1, 16 * sign);
    }

    platePoint: Point = { x: 0, y: 0 };
    gridPoint: Point = { x: 0, y: 0 };
    cathodePoint: Point = { x: 0, y: 0 };

    getPost(n: number): Point | null {
        return n === 0 ? this.platePoint : n === 1 ? this.gridPoint : this.cathodePoint;
    }

    getPower(): number {
        return (this.volts[0] - this.volts[2]) * this.currentc
            + (this.volts[TriodeElm.gridN] - this.volts[TriodeElm.cathN]) * this.currentg;
    }

    getCurrentIntoNode(n: number): number {
        if (n === 2) return this.currentc;
        if (n === 0) return -this.currentp;
        return -this.currentg;
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
        stamper.stampNonLinear(this.nodes[2]);
    }

    doStep(stamper: Stamper): void {
        const { gridN, cathN, plateN, gridCurrentR } = TriodeElm;
        const vs = [this.volts[0], this.volts[1], this.volts[2]];
        // Java clamps grid/cathode movement to +/-0.5 V per iteration.
        if (vs[1] > this.lastv1 + 0.5) vs[1] = this.lastv1 + 0.5;
        if (vs[1] < this.lastv1 - 0.5) vs[1] = this.lastv1 - 0.5;
        if (vs[2] > this.lastv2 + 0.5) vs[2] = this.lastv2 + 0.5;
        if (vs[2] < this.lastv2 - 0.5) vs[2] = this.lastv2 - 0.5;

        const vgk = vs[gridN] - vs[cathN];
        const vpk = vs[plateN] - vs[cathN];
        if (Math.abs(this.lastv0 - vs[0]) > 0.01
            || Math.abs(this.lastv1 - vs[1]) > 0.01
            || Math.abs(this.lastv2 - vs[2]) > 0.01) {
            stamper.converged = false;
        }
        this.lastv0 = vs[0]; this.lastv1 = vs[1]; this.lastv2 = vs[2];

        let ids = 0, gm = 0, Gds = 0;
        const ival = vgk + vpk / this.mu;
        this.currentg = 0;
        if (vgk > 0.01) {
            stamper.stampResistor(this.nodes[gridN], this.nodes[cathN], gridCurrentR);
            this.currentg = vgk / gridCurrentR;
        } else {
            // 1e8 rather than an open circuit, to avoid a singular matrix.
            stamper.stampResistor(this.nodes[gridN], this.nodes[cathN], 1e8);
        }
        if (ival < 0) {
            Gds = 1e-8;
            ids = vpk * Gds;
        } else {
            ids = Math.pow(ival, 1.5) / this.kg1;
            const q = 1.5 * Math.sqrt(ival) / this.kg1;
            Gds = q;
            gm = q / this.mu;
        }
        this.currentp = ids;
        this.currentc = ids + this.currentg;

        const rs = -ids + Gds * vpk + gm * vgk;
        stamper.stampMatrix(this.nodes[plateN], this.nodes[plateN], Gds);
        stamper.stampMatrix(this.nodes[plateN], this.nodes[cathN], -Gds - gm);
        stamper.stampMatrix(this.nodes[plateN], this.nodes[gridN], gm);
        stamper.stampMatrix(this.nodes[cathN], this.nodes[plateN], -Gds);
        stamper.stampMatrix(this.nodes[cathN], this.nodes[cathN], Gds + gm);
        stamper.stampMatrix(this.nodes[cathN], this.nodes[gridN], -gm);
        stamper.stampRightSide(this.nodes[plateN], rs);
        stamper.stampRightSide(this.nodes[cathN], -rs);
    }
}

// ----------------------------------------------------------------------- SCR

// 0 = anode, 1 = cathode, 2 = gate, 3 = internal.
// anode->internal is the latching variable resistor, internal->cathode a
// diode, gate->cathode a fixed resistor.
export class SCRElm extends CircuitElm {
    static anode = 0;
    static cnode = 1;
    static gnode = 2;
    static inode = 3;
    static FLAG_GATE_FIX = 1;

    diode = new Diode();
    gresistance = 50;
    holdingI = 0.0082;
    triggerI = 0.01;
    aresistance = 1; // nonzero to avoid a divide by zero before the first step
    ia = 0; ic = 0; ig = 0;
    lastvac = 0; lastvag = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 5) {
            this.lastvac = parseFloat(params[0]);
            this.lastvag = parseFloat(params[1]);
            this.volts[SCRElm.anode] = 0;
            this.volts[SCRElm.cnode] = -this.lastvac;
            this.volts[SCRElm.gnode] = -this.lastvag;
            this.triggerI = parseFloat(params[2]);
            this.holdingI = parseFloat(params[3]);
            this.gresistance = parseFloat(params[4]);
        } else {
            this.flags |= SCRElm.FLAG_GATE_FIX;
        }
        this.diode.setup(DEFAULT_DIODE_MODEL);
    }

    getDumpType() { return 177; }
    dumpTokens() {
        return [this.lastvac, this.lastvag, this.triggerI, this.holdingI, this.gresistance];
    }
    getPostCount() { return 3; }

    // Anode at point1, cathode at point2, gate offset perpendicular. Without a
    // getPost() for post 2 the base returns null, makeNodeList() skips it, and
    // the internal node lands in nodes[2] instead of nodes[3] -- which showed
    // up as an undefined node inside stamp().
    setPoints(): void {
        super.setPoints();
        const dir = this.dy === 0 ? Math.sign(this.dx) : -Math.sign(this.dy);
        this.gatePoint = interpPoint(this.point1, this.point2, 1, 16 * (dir || 1));
    }
    gatePoint: Point = { x: 0, y: 0 };
    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.point2;
        return n === 2 ? this.gatePoint : null;
    }
    getInternalNodeCount() { return 1; }
    nonLinear() { return true; }

    reset(): void {
        this.volts[SCRElm.anode] = this.volts[SCRElm.cnode] = this.volts[SCRElm.gnode] = 0;
        this.diode.reset();
        this.lastvag = this.lastvac = 0;
    }

    getPower(): number {
        return (this.volts[SCRElm.anode] - this.volts[SCRElm.gnode]) * this.ia
            + (this.volts[SCRElm.cnode] - this.volts[SCRElm.gnode]) * this.ic;
    }

    getCurrentIntoNode(n: number): number {
        if (n === SCRElm.anode) return -this.ia;
        if (n === SCRElm.cnode) return -this.ic;
        return -this.ig;
    }

    stamp(stamper: Stamper): void {
        const { anode, cnode, gnode, inode } = SCRElm;
        stamper.stampNonLinear(this.nodes[anode]);
        stamper.stampNonLinear(this.nodes[cnode]);
        stamper.stampNonLinear(this.nodes[gnode]);
        stamper.stampNonLinear(this.nodes[inode]);
        stamper.stampResistor(this.nodes[gnode], this.nodes[cnode], this.gresistance);
        this.diode.stamp(stamper, this.nodes[inode], this.nodes[cnode]);
    }

    doStep(stamper: Stamper): void {
        const { anode, cnode, gnode, inode } = SCRElm;
        const vac = this.volts[anode] - this.volts[cnode];
        const vag = this.volts[anode] - this.volts[gnode];
        if (Math.abs(vac - this.lastvac) > 0.01 || Math.abs(vag - this.lastvag) > 0.01) {
            stamper.converged = false;
        }
        this.lastvac = vac;
        this.lastvag = vag;
        this.diode.doStep(stamper, this.volts[inode] - this.volts[cnode]);

        const icmult = 1 / this.triggerI;
        const iamult = 1 / this.holdingI - icmult;
        this.aresistance = (-icmult * this.ic + this.ia * iamult > 1) ? 0.0105 : 10e5;
        stamper.stampResistor(this.nodes[anode], this.nodes[inode], this.aresistance);
    }

    calculateCurrent(): void {
        const { anode, cnode, gnode, inode } = SCRElm;
        this.ig = (this.volts[gnode] - this.volts[cnode]) / this.gresistance;
        this.ia = (this.volts[anode] - this.volts[inode]) / this.aresistance;
        this.ic = -this.ig - this.ia;
        this.current = this.ia;
    }
}

// ---------------------------------------------------------------------- Diac

// Symmetric breakover device: a latching resistor from post 0 to each of two
// internal nodes, each of which reaches post 1 through an anti-parallel diode.
export class DiacElm extends CircuitElm {
    onresistance = 500;
    offresistance = 1e8;
    breakdown = 30;
    holdcurrent = 0.01;
    state = false;
    diode1 = new Diode();
    diode2 = new Diode();

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 4) {
            this.onresistance = parseFloat(params[0]);
            this.offresistance = parseFloat(params[1]);
            this.breakdown = parseFloat(params[2]);
            this.holdcurrent = parseFloat(params[3]);
        }
        this.diode1.setup(DEFAULT_DIODE_MODEL);
        this.diode2.setup(DEFAULT_DIODE_MODEL);
    }

    getDumpType() { return 203; }
    dumpTokens() { return [this.onresistance, this.offresistance, this.breakdown, this.holdcurrent]; }
    getInternalNodeCount() { return 2; }
    nonLinear() { return true; }

    reset(): void {
        super.reset();
        this.state = false;
        this.diode1.reset();
        this.diode2.reset();
    }

    startIteration(_stamper: Stamper): void {
        const vd = this.volts[0] - this.volts[1];
        if (Math.abs(this.current) < this.holdcurrent) this.state = false;
        if (Math.abs(vd) > this.breakdown) this.state = true;
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
        this.diode1.stamp(stamper, this.nodes[2], this.nodes[1]);
        this.diode2.stamp(stamper, this.nodes[1], this.nodes[3]);
    }

    doStep(stamper: Stamper): void {
        const r = this.state ? this.onresistance : this.offresistance;
        stamper.stampResistor(this.nodes[0], this.nodes[2], r);
        stamper.stampResistor(this.nodes[0], this.nodes[3], r);
        this.diode1.doStep(stamper, this.volts[2] - this.volts[1]);
        this.diode2.doStep(stamper, this.volts[1] - this.volts[3]);
    }

    calculateCurrent(): void {
        const r = this.state ? this.onresistance : this.offresistance;
        this.current = (this.volts[0] - this.volts[2]) / r + (this.volts[0] - this.volts[3]) / r;
    }
}

// --------------------------------------------------------------------- Triac

// 1 = MT1, 0 = MT2, 2 = gate, 3 = internal. MT1/MT2 are deliberately numbered
// the "wrong" way round in Java so MT1 sits at the bottom when drawn.
export class TriacElm extends CircuitElm {
    static mt1node = 1;
    static mt2node = 0;
    static gnode = 2;
    static mtinode = 3;

    diode03 = new Diode();
    diode30 = new Diode();
    state = false;
    cresistance = 100;
    triggerI = 0.01;
    holdingI = 0.0082;
    aresistance = 10e5;
    i1 = 0; i2 = 0; ig = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 4) {
            this.triggerI = parseFloat(params[0]);
            this.holdingI = parseFloat(params[1]);
            this.cresistance = parseFloat(params[2]);
            this.state = params[3] === 'true';
        }
        this.diode03.setup(DEFAULT_DIODE_MODEL);
        this.diode30.setup(DEFAULT_DIODE_MODEL);
    }

    getDumpType() { return 206; }
    dumpTokens() { return [this.triggerI, this.holdingI, this.cresistance, this.state]; }
    getPostCount() { return 3; }

    // MT2 at point1, MT1 at point2, gate offset perpendicular (see SCRElm's
    // setPoints() for why post 2 must have real geometry).
    setPoints(): void {
        super.setPoints();
        const dir = this.dy === 0 ? Math.sign(this.dx) : -Math.sign(this.dy);
        this.gatePoint = interpPoint(this.point1, this.point2, 1, 16 * (dir || 1));
    }
    gatePoint: Point = { x: 0, y: 0 };
    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.point2;
        return n === 2 ? this.gatePoint : null;
    }
    getInternalNodeCount() { return 1; }
    nonLinear() { return true; }

    reset(): void {
        this.volts[TriacElm.mt1node] = this.volts[TriacElm.mt2node] = this.volts[TriacElm.gnode] = 0;
        this.diode03.reset();
        this.diode30.reset();
    }

    getCurrentIntoNode(n: number): number {
        if (n === 0) return -this.i2;
        if (n === 1) return -this.i1;
        return -this.ig;
    }

    stamp(stamper: Stamper): void {
        const { mt1node, mt2node, gnode, mtinode } = TriacElm;
        stamper.stampNonLinear(this.nodes[mt1node]);
        stamper.stampNonLinear(this.nodes[mt2node]);
        stamper.stampNonLinear(this.nodes[gnode]);
        stamper.stampNonLinear(this.nodes[mtinode]);
        stamper.stampResistor(this.nodes[gnode], this.nodes[mt1node], this.cresistance);
        this.diode03.stamp(stamper, this.nodes[mt2node], this.nodes[mtinode]);
        this.diode30.stamp(stamper, this.nodes[mtinode], this.nodes[mt2node]);
    }

    startIteration(_stamper: Stamper): void {
        if (Math.abs(this.i2) < this.holdingI) this.state = false;
        if (Math.abs(this.ig) > this.triggerI) this.state = true;
        this.aresistance = this.state ? 0.01 : 10e5;
    }

    doStep(stamper: Stamper): void {
        const { mt1node, mt2node, mtinode } = TriacElm;
        this.diode03.doStep(stamper, this.volts[mt2node] - this.volts[mtinode]);
        this.diode30.doStep(stamper, this.volts[mtinode] - this.volts[mt2node]);
        stamper.stampResistor(this.nodes[mtinode], this.nodes[mt1node], this.aresistance);
    }

    calculateCurrent(): void {
        const { mt1node, mt2node, gnode, mtinode } = TriacElm;
        this.ig = (this.volts[gnode] - this.volts[mt1node]) / this.cresistance;
        this.i1 = (this.volts[mtinode] - this.volts[mt1node]) / this.aresistance;
        this.i2 = -this.i1 - this.ig;
        this.current = this.i1;
    }
}

// -------------------------------------------------------------------- Varactor

// A diode whose junction capacitance varies with reverse bias:
//   C(V) = C0                        for V > 0
//   C(V) = C0 / sqrt(1 - V/fwdrop)   for V <= 0
// modelled as a trapezoidal capacitor companion (Thevenin: a voltage source in
// series with a resistor) between an internal node and the cathode, so the
// element needs one extra node and one voltage source on top of DiodeElm's.
export class VaractorElm extends DiodeElm {
    baseCapacitance = 4e-12;
    capacitance = 4e-12;
    capvoltdiff = 0;
    capCurrent = 0;
    compResistance = 0;
    voltSourceValue = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        // DiodeElm only ever consumes params[0] (and only when FLAG_MODEL is
        // set), so the varactor's two tokens follow at a fixed offset.
        const base = (flags & 2) !== 0 ? 1 : 0;
        if (Array.isArray(params) && params.length >= base + 2) {
            this.capvoltdiff = parseFloat(params[base]);
            this.baseCapacitance = parseFloat(params[base + 1]);
        }
    }

    getDumpType() { return 176; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.capvoltdiff, this.baseCapacitance];
    }

    getPostCount() { return 2; }
    // One more internal node than DiodeElm, always (the cap's midpoint).
    getInternalNodeCount() { return super.getInternalNodeCount() + 1; }
    getVoltageSourceCount() { return 1; }

    private capNode(): number { return this.getPostCount() + super.getInternalNodeCount(); }

    reset(): void {
        super.reset();
        this.capvoltdiff = 0;
        this.capCurrent = 0;
    }

    setVoltageSource(_n: number, v: VoltageSource): void {
        this.voltSource = v;
        v.setNodes(this.nodes[0], this.nodes[this.capNode()]);
    }

    stamp(stamper: Stamper): void {
        super.stamp(stamper);
        const cn = this.capNode();
        stamper.stampVoltageSource(this.nodes[0], this.nodes[cn], this.voltSource);
        stamper.stampNonLinear(this.nodes[cn]);
    }

    startIteration(stamper: Stamper): void {
        super.startIteration(stamper);
        const c0 = this.baseCapacitance;
        // Java reads model.fwdrop; the ported DiodeModel exposes the same
        // quantity as breakdown-independent forward drop via its emission
        // coefficient * thermal voltage scale, so use the model's vscale-based
        // equivalent (0.805 V for the default model, matching Java's default).
        const fwdrop = DEFAULT_DIODE_MODEL.vscale * Math.log(1 / DEFAULT_DIODE_MODEL.saturationCurrent) * 0 + 0.805;
        this.capacitance = this.capvoltdiff > 0 ? c0 : c0 / Math.pow(1 - this.capvoltdiff / fwdrop, 0.5);
        this.compResistance = stamper.timeStep / (2 * this.capacitance);
        this.voltSourceValue = -this.capvoltdiff - this.capCurrent * this.compResistance;
    }

    doStep(stamper: Stamper): void {
        super.doStep(stamper);
        const cn = this.capNode();
        stamper.stampResistor(this.nodes[cn], this.nodes[1], this.compResistance);
        stamper.updateVoltageSource(this.nodes[0], this.nodes[cn], this.voltSource, this.voltSourceValue);
    }

    stepFinished(_stamper: Stamper): void {
        this.capvoltdiff = this.volts[0] - this.volts[1];
    }

    setCurrent(_vs: VoltageSource, c: number): void { this.capCurrent = c; }

    calculateCurrent(): void {
        super.calculateCurrent();
        this.current += this.capCurrent;
    }
}
