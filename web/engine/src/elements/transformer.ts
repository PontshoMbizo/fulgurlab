import { CircuitElm, Stamper, Point, interpPoint } from './base';
import { VoltageSource } from '../core/node';

// The magnetically-coupled and distributed elements: TransformerElm ('T'/84),
// TappedTransformerElm (169), CustomTransformerElm (406) and TransLineElm
// (171).
//
// The two-winding transformer inverts the coupled-inductor equations
//    v1 = L1 di1/dt + M  di2/dt
//    v2 = M  di1/dt + L2 di2/dt
// into di/dt = A v, then integrates with trapezoidal (default) or backward
// Euler and stamps the Norton equivalent: a conductance on each winding plus a
// voltage-controlled current source coupling them. All the commentary and the
// exact coefficient algebra come straight from TransformerElm.java.

const FLAG_BACK_EULER = 2; // Inductor.FLAG_BACK_EULER

export class TransformerElm extends CircuitElm {
    static FLAG_REVERSE = 4;
    static FLAG_VERTICAL = 8;
    static FLAG_FLIP = 16;

    inductance = 4;
    ratio = 1;
    couplingCoef = 0.999;
    saturationCurrent = 0; // 0 = linear core
    width = 32;
    polarity = 1;
    currents = [0, 0];
    a1 = 0; a2 = 0; a3 = 0; a4 = 0;
    curSourceValue1 = 0;
    curSourceValue2 = 0;
    ptEnds: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 4) {
            this.inductance = parseFloat(params[0]);
            this.ratio = parseFloat(params[1]);
            this.currents[0] = parseFloat(params[2]);
            this.currents[1] = parseFloat(params[3]);
            if (params.length > 4) {
                const c = parseFloat(params[4]);
                if (Number.isFinite(c)) this.couplingCoef = c;
            }
            if (params.length > 5) {
                const s = parseFloat(params[5]);
                if (Number.isFinite(s)) this.saturationCurrent = s;
            }
        }
        this.width = this.hasFlag(TransformerElm.FLAG_VERTICAL)
            ? -Math.max(32, Math.abs(x2 - x))
            : Math.max(32, Math.abs(y2 - y));
        this.polarity = this.hasFlag(TransformerElm.FLAG_REVERSE) ? -1 : 1;
    }

    hasFlag(f: number) { return (this.flags & f) !== 0; }
    getDumpType() { return 'T'; }
    dumpTokens() {
        return [this.inductance, this.ratio, this.currents[0], this.currents[1],
            this.couplingCoef, this.saturationCurrent];
    }
    getPostCount() { return 4; }
    nonLinear() { return this.saturationCurrent > 0; }
    isTrapezoidal() { return (this.flags & FLAG_BACK_EULER) === 0; }

    // Posts: 0/2 are the primary's two ends, 1/3 the secondary's. Java derives
    // them from the point1/point2 line offset by `width`; a reversed-polarity
    // transformer swaps 1 and 3.
    setPoints(): void {
        super.setPoints();
        if (this.hasFlag(TransformerElm.FLAG_VERTICAL)) this.point2 = { x: this.point1.x, y: this.point2.y };
        else this.point2 = { x: this.point2.x, y: this.point1.y };
        this.width = this.hasFlag(TransformerElm.FLAG_VERTICAL)
            ? -Math.max(32, Math.abs(this.x2 - this.x))
            : Math.max(32, Math.abs(this.y2 - this.y));
        this.polarity = this.hasFlag(TransformerElm.FLAG_REVERSE) ? -1 : 1;

        const ends: Point[] = [
            this.point1,
            this.point2,
            interpPoint(this.point1, this.point2, 0, -this.width),
            interpPoint(this.point1, this.point2, 1, -this.width),
        ];
        if (this.polarity === -1) {
            const t = ends[1]; ends[1] = ends[3]; ends[3] = t;
        }
        this.ptEnds = ends;
    }

    getPost(n: number): Point | null { return this.ptEnds[n] ?? null; }

    reset(): void {
        // Set the current-source values here too: if one of the nodes is node
        // 0, calculateCurrent() can run (from setNodeVoltage(), during
        // analysis) before startIteration() ever does.
        this.currents[0] = this.currents[1] = 0;
        this.volts[0] = this.volts[1] = this.volts[2] = this.volts[3] = 0;
        this.curSourceValue1 = this.curSourceValue2 = 0;
    }

    // L(I) = L0 / (1 + (I/Isat)^2)
    private calcEffectiveInductance(l0: number, i: number, isat: number): number {
        if (isat <= 0) return l0;
        const r = i / isat;
        return l0 / (1 + r * r);
    }

    private computeCoefficients(l1: number, l2: number, m: number, timeStep: number): void {
        const deti = 1 / (l1 * l2 - m * m);
        const ts = this.isTrapezoidal() ? timeStep / 2 : timeStep;
        this.a1 = l2 * deti * ts;
        this.a2 = -m * deti * ts;
        this.a3 = -m * deti * ts;
        this.a4 = l1 * deti * ts;
    }

    private stampCoupling(stamper: Stamper): void {
        stamper.stampConductance(this.nodes[0], this.nodes[2], this.a1);
        stamper.stampVCCurrentSource(this.nodes[0], this.nodes[2], this.nodes[1], this.nodes[3], this.a2);
        stamper.stampVCCurrentSource(this.nodes[1], this.nodes[3], this.nodes[0], this.nodes[2], this.a3);
        stamper.stampConductance(this.nodes[1], this.nodes[3], this.a4);
    }

    stamp(stamper: Stamper): void {
        const l1 = this.inductance;
        const l2 = this.inductance * this.ratio * this.ratio;
        const m = this.couplingCoef * Math.sqrt(l1 * l2);
        this.computeCoefficients(l1, l2, m, stamper.timeStep);
        if (this.saturationCurrent > 0) {
            for (let i = 0; i < 4; i++) stamper.stampNonLinear(this.nodes[i]);
        } else {
            this.stampCoupling(stamper);
        }
    }

    startIteration(stamper: Stamper): void {
        if (this.saturationCurrent > 0) {
            const l1 = this.calcEffectiveInductance(this.inductance, this.currents[0], this.saturationCurrent);
            const l2 = this.calcEffectiveInductance(this.inductance * this.ratio * this.ratio,
                this.currents[1], this.saturationCurrent * this.ratio);
            const m = this.couplingCoef * Math.sqrt(l1 * l2);
            this.computeCoefficients(l1, l2, m, stamper.timeStep);
        }
        const voltdiff1 = this.volts[0] - this.volts[2];
        const voltdiff2 = this.volts[1] - this.volts[3];
        if (this.isTrapezoidal()) {
            this.curSourceValue1 = voltdiff1 * this.a1 + voltdiff2 * this.a2 + this.currents[0];
            this.curSourceValue2 = voltdiff1 * this.a3 + voltdiff2 * this.a4 + this.currents[1];
        } else {
            this.curSourceValue1 = this.currents[0];
            this.curSourceValue2 = this.currents[1];
        }
    }

    doStep(stamper: Stamper): void {
        if (this.saturationCurrent > 0) this.stampCoupling(stamper);
        stamper.stampCurrentSource(this.nodes[0], this.nodes[2], this.curSourceValue1);
        stamper.stampCurrentSource(this.nodes[1], this.nodes[3], this.curSourceValue2);
    }

    calculateCurrent(): void {
        const voltdiff1 = this.volts[0] - this.volts[2];
        const voltdiff2 = this.volts[1] - this.volts[3];
        this.currents[0] = voltdiff1 * this.a1 + voltdiff2 * this.a2 + this.curSourceValue1;
        this.currents[1] = voltdiff1 * this.a3 + voltdiff2 * this.a4 + this.curSourceValue2;
        this.current = this.currents[0];
    }

    getCurrentIntoNode(n: number): number {
        return n < 2 ? -this.currents[n] : this.currents[n - 2];
    }

    // Primary (0-2) and secondary (1-3) are galvanically isolated.
    getConnection(n1: number, n2: number): boolean { return (n1 % 2) === (n2 % 2); }
}

// ------------------------------------------------------- TappedTransformer

// Centre-tapped secondary: 5 posts (primary 0-1, secondary 2-3-4 with 3 the
// tap). Three coupled windings means a 3x3 inverse instead of 2x2; the closed
// form below is Java's, not a general solve.
export class TappedTransformerElm extends CircuitElm {
    static FLAG_FLIP = 1;

    inductance = 4;
    ratio = 1;
    couplingCoef = 0.99;
    currents = [0, 0, 0, 0];
    a = new Array(9).fill(0);
    voltdiff = [0, 0, 0];
    curSourceValue = [0, 0, 0];
    ptEnds: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 4) {
            this.inductance = parseFloat(params[0]);
            this.ratio = parseFloat(params[1]);
            this.currents[0] = parseFloat(params[2]);
            this.currents[1] = parseFloat(params[3]);
            if (params.length > 4) {
                const c = parseFloat(params[4]);
                if (Number.isFinite(c)) this.currents[2] = c;
            }
            if (params.length > 5) {
                const c = parseFloat(params[5]);
                if (Number.isFinite(c)) this.couplingCoef = c;
            }
        }
    }

    getDumpType() { return 169; }
    dumpTokens() {
        return [this.inductance, this.ratio, this.currents[0], this.currents[1],
            this.currents[2], this.couplingCoef];
    }
    getPostCount() { return 5; }
    isTrapezoidal() { return (this.flags & FLAG_BACK_EULER) === 0; }

    setPoints(): void {
        super.setPoints();
        const flip = (this.flags & TappedTransformerElm.FLAG_FLIP) !== 0 ? -1 : 1;
        const hs = 32 * flip;
        this.ptEnds = [
            this.point1,
            interpPoint(this.point1, this.point2, 0, -hs * 2),
            this.point2,
            interpPoint(this.point1, this.point2, 1, -hs),
            interpPoint(this.point1, this.point2, 1, -hs * 2),
        ];
    }

    getPost(n: number): Point | null { return this.ptEnds[n] ?? null; }

    reset(): void {
        this.currents = [0, 0, 0, 0];
        for (let i = 0; i < 5; i++) this.volts[i] = 0;
        this.curSourceValue = [0, 0, 0];
    }

    stamp(stamper: Stamper): void {
        const l1 = this.inductance;
        const l2 = this.inductance * this.ratio * this.ratio / 4;
        const m1 = this.couplingCoef * Math.sqrt(l1 * l2);
        const m2 = this.couplingCoef * l2;
        const a = this.a;
        a[0] = l2 + m2;
        a[1] = a[2] = a[3] = a[6] = -m1;
        a[4] = a[8] = (l1 * l2 - m1 * m1) / (l2 - m2);
        a[5] = a[7] = (m1 * m1 - l1 * m2) / (l2 - m2);
        const det = l1 * (l2 + m2) - 2 * m1 * m1;
        const ts = this.isTrapezoidal() ? stamper.timeStep / 2 : stamper.timeStep;
        for (let i = 0; i !== 9; i++) a[i] *= ts / det;

        const n = this.nodes;
        stamper.stampConductance(n[0], n[1], a[0]);
        stamper.stampVCCurrentSource(n[0], n[1], n[2], n[3], a[1]);
        stamper.stampVCCurrentSource(n[0], n[1], n[3], n[4], a[2]);
        stamper.stampVCCurrentSource(n[2], n[3], n[0], n[1], a[3]);
        stamper.stampConductance(n[2], n[3], a[4]);
        stamper.stampVCCurrentSource(n[2], n[3], n[3], n[4], a[5]);
        stamper.stampVCCurrentSource(n[3], n[4], n[0], n[1], a[6]);
        stamper.stampVCCurrentSource(n[3], n[4], n[2], n[3], a[7]);
        stamper.stampConductance(n[3], n[4], a[8]);
    }

    private updateVoltDiffs(): void {
        this.voltdiff[0] = this.volts[0] - this.volts[1];
        this.voltdiff[1] = this.volts[2] - this.volts[3];
        this.voltdiff[2] = this.volts[3] - this.volts[4];
    }

    startIteration(_stamper: Stamper): void {
        this.updateVoltDiffs();
        for (let i = 0; i !== 3; i++) {
            this.curSourceValue[i] = this.currents[i];
            if (this.isTrapezoidal()) {
                for (let j = 0; j !== 3; j++) {
                    this.curSourceValue[i] += this.a[i * 3 + j] * this.voltdiff[j];
                }
            }
        }
    }

    doStep(stamper: Stamper): void {
        const n = this.nodes;
        stamper.stampCurrentSource(n[0], n[1], this.curSourceValue[0]);
        stamper.stampCurrentSource(n[2], n[3], this.curSourceValue[1]);
        stamper.stampCurrentSource(n[3], n[4], this.curSourceValue[2]);
    }

    calculateCurrent(): void {
        this.updateVoltDiffs();
        for (let i = 0; i !== 3; i++) {
            this.currents[i] = this.curSourceValue[i];
            for (let j = 0; j !== 3; j++) {
                this.currents[i] += this.a[i * 3 + j] * this.voltdiff[j];
            }
        }
        this.currents[3] = this.currents[1] - this.currents[2];
        this.current = this.currents[0];
    }

    // Primary is posts 0-1, secondary is 2-3-4.
    getConnection(n1: number, n2: number): boolean {
        return (n1 < 2) === (n2 < 2);
    }
}

// ------------------------------------------------------- CustomTransformer

// N-winding transformer with a user-defined turns ratio per winding. Java
// stores the winding description as a "/"-separated spec string and builds an
// NxN coupled-inductor system; this port keeps the same dump shape and solves
// the NxN inverse numerically (Gauss-Jordan) rather than by a closed form,
// which is what makes an arbitrary winding count tractable.
export class CustomTransformerElm extends CircuitElm {
    inductance = 4;
    couplingCoef = 0.999;
    description = '1:1';
    windingCounts: number[] = [1, 1];
    currents: number[] = [];
    curSourceValue: number[] = [];
    a: number[][] = [];
    private nWindings = 2;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 2) {
            this.inductance = parseFloat(params[0]);
            this.couplingCoef = parseFloat(params[1]);
            if (params.length > 2) this.description = params[2];
        }
        this.parseDescription();
    }

    // "1:1", "1:1:1", "2:1" ... — a ratio per winding, colon-separated.
    private parseDescription(): void {
        const parts = this.description.split(':').map(s => parseFloat(s)).filter(v => Number.isFinite(v) && v > 0);
        this.windingCounts = parts.length >= 2 ? parts : [1, 1];
        this.nWindings = this.windingCounts.length;
        this.currents = new Array(this.nWindings).fill(0);
        this.curSourceValue = new Array(this.nWindings).fill(0);
    }

    getDumpType() { return 406; }
    dumpTokens() { return [this.inductance, this.couplingCoef, this.description]; }
    getPostCount() { return this.nWindings * 2; }
    isTrapezoidal() { return (this.flags & FLAG_BACK_EULER) === 0; }

    setPoints(): void {
        super.setPoints();
        const width = Math.max(32, Math.abs(this.y2 - this.y));
        this.ptEnds = [];
        for (let i = 0; i < this.nWindings; i++) {
            this.ptEnds.push(interpPoint(this.point1, this.point2, 0, -width * i));
            this.ptEnds.push(interpPoint(this.point1, this.point2, 1, -width * i));
        }
    }
    ptEnds: Point[] = [];
    getPost(n: number): Point | null { return this.ptEnds[n] ?? null; }

    reset(): void {
        this.currents.fill(0);
        this.curSourceValue.fill(0);
        this.volts.fill(0);
    }

    // Build L (self/mutual inductance matrix) then A = ts * L^-1.
    private computeCoefficients(timeStep: number): void {
        const n = this.nWindings;
        const L: number[][] = [];
        for (let i = 0; i < n; i++) {
            L.push(new Array(n).fill(0));
            const li = this.inductance * this.windingCounts[i] * this.windingCounts[i];
            L[i][i] = li;
        }
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                L[i][j] = this.couplingCoef * Math.sqrt(L[i][i] * L[j][j]);
            }
        }
        const inv = invertMatrix(L);
        const ts = this.isTrapezoidal() ? timeStep / 2 : timeStep;
        this.a = inv.map(row => row.map(v => v * ts));
    }

    private voltDiff(i: number): number { return this.volts[i * 2] - this.volts[i * 2 + 1]; }

    stamp(stamper: Stamper): void {
        this.computeCoefficients(stamper.timeStep);
        const n = this.nWindings;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const a = this.nodes[i * 2], b = this.nodes[i * 2 + 1];
                if (i === j) stamper.stampConductance(a, b, this.a[i][j]);
                else stamper.stampVCCurrentSource(a, b, this.nodes[j * 2], this.nodes[j * 2 + 1], this.a[i][j]);
            }
        }
    }

    startIteration(_stamper: Stamper): void {
        for (let i = 0; i < this.nWindings; i++) {
            this.curSourceValue[i] = this.currents[i];
            if (this.isTrapezoidal()) {
                for (let j = 0; j < this.nWindings; j++) {
                    this.curSourceValue[i] += this.a[i][j] * this.voltDiff(j);
                }
            }
        }
    }

    doStep(stamper: Stamper): void {
        for (let i = 0; i < this.nWindings; i++) {
            stamper.stampCurrentSource(this.nodes[i * 2], this.nodes[i * 2 + 1], this.curSourceValue[i]);
        }
    }

    calculateCurrent(): void {
        for (let i = 0; i < this.nWindings; i++) {
            this.currents[i] = this.curSourceValue[i];
            for (let j = 0; j < this.nWindings; j++) {
                this.currents[i] += this.a[i][j] * this.voltDiff(j);
            }
        }
        this.current = this.currents[0] ?? 0;
    }

    getCurrentIntoNode(n: number): number {
        const w = Math.floor(n / 2);
        return (n % 2 === 0) ? -this.currents[w] : this.currents[w];
    }

    // Each winding is its own isolated pair.
    getConnection(n1: number, n2: number): boolean {
        return Math.floor(n1 / 2) === Math.floor(n2 / 2);
    }
}

// Gauss-Jordan inverse. Small (N <= a handful of windings), so pivoting by
// magnitude is enough and no LU reuse is warranted.
function invertMatrix(m: number[][]): number[][] {
    const n = m.length;
    const a = m.map(r => [...r]);
    const inv: number[][] = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
        if (Math.abs(a[piv][col]) < 1e-300) continue; // singular; leave row as-is
        [a[col], a[piv]] = [a[piv], a[col]];
        [inv[col], inv[piv]] = [inv[piv], inv[col]];
        const d = a[col][col];
        for (let j = 0; j < n; j++) { a[col][j] /= d; inv[col][j] /= d; }
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = a[r][col];
            if (f === 0) continue;
            for (let j = 0; j < n; j++) { a[r][j] -= f * a[col][j]; inv[r][j] -= f * inv[col][j]; }
        }
    }
    return inv;
}

// -------------------------------------------------------------- TransLine

// Lossless transmission line: a pair of delay lines feeding two voltage
// sources, each in series with the characteristic impedance. Posts 0/1 are the
// far side, 2/3 the near side; nodes 4/5 are internal.
export class TransLineElm extends CircuitElm {
    delay: number;
    imped = 75;
    width = 16;
    lenSteps = 0;
    ptr = 0;
    voltageL: Float64Array | null = null;
    voltageR: Float64Array | null = null;
    voltSource1!: VoltageSource;
    voltSource2!: VoltageSource;
    stopMessage: string | null = null;
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // Java's default is 1000 * sim.maxTimeStep; the engine's default max
        // timestep is 5e-6, so 5ms.
        this.delay = 1000 * 5e-6;
        if (Array.isArray(params) && params.length >= 3) {
            this.delay = parseFloat(params[0]);
            this.imped = parseFloat(params[1]);
            this.width = parseInt(params[2], 10) || 16;
        }
    }

    getDumpType() { return 171; }
    // Java emits a trailing unused 0.0 and its constructor consumes it.
    dumpTokens() { return [this.delay, this.imped, this.width, 0]; }
    getPostCount() { return 4; }
    getInternalNodeCount() { return 2; }
    getVoltageSourceCount() { return 2; }

    setPoints(): void {
        super.setPoints();
        const ds = this.dy === 0 ? Math.sign(this.dx) : -Math.sign(this.dy);
        const p3 = interpPoint(this.point1, this.point2, 0, -this.width * ds);
        const p4 = interpPoint(this.point1, this.point2, 1, -this.width * ds);
        this.posts = [p3, p4, this.point1, this.point2];
    }

    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    // Sized from the engine's maximum timestep, so it must be re-primed
    // whenever that changes. Called from preStamp() via reset-on-analyze.
    setupDelayLine(maxTimeStep: number): void {
        if (maxTimeStep === 0) return;
        this.lenSteps = Math.floor(this.delay / maxTimeStep);
        if (this.lenSteps > 100000 || this.lenSteps < 1) {
            this.voltageL = this.voltageR = null;
        } else {
            this.voltageL = new Float64Array(this.lenSteps);
            this.voltageR = new Float64Array(this.lenSteps);
        }
        this.ptr = 0;
    }

    reset(): void {
        super.reset();
        this.ptr = 0;
        this.stopMessage = null;
        if (this.voltageL) this.voltageL.fill(0);
        if (this.voltageR) this.voltageR.fill(0);
    }

    setVoltageSource(j: number, vs: VoltageSource): void {
        if (j === 0) {
            this.voltSource1 = vs;
            vs.setNodes(this.nodes[4], this.nodes[0]);
        } else {
            this.voltSource2 = vs;
            vs.setNodes(this.nodes[5], this.nodes[1]);
        }
    }

    stamp(stamper: Stamper): void {
        if (!this.voltageL) this.setupDelayLine(stamper.timeStep);
        stamper.stampVoltageSource(this.nodes[4], this.nodes[0], this.voltSource1);
        stamper.stampVoltageSource(this.nodes[5], this.nodes[1], this.voltSource2);
        stamper.stampResistor(this.nodes[2], this.nodes[4], this.imped);
        stamper.stampResistor(this.nodes[3], this.nodes[5], this.imped);
    }

    startIteration(_stamper: Stamper): void {
        if (!this.voltageL || !this.voltageR) {
            this.stopMessage = 'Transmission line delay too large!';
            return;
        }
        this.voltageL[this.ptr] = this.volts[2] - this.volts[0] + this.volts[2] - this.volts[4];
        this.voltageR[this.ptr] = this.volts[3] - this.volts[1] + this.volts[3] - this.volts[5];
    }

    doStep(stamper: Stamper): void {
        if (!this.voltageL || !this.voltageR) {
            this.stopMessage = 'Transmission line delay too large!';
            return;
        }
        const nextPtr = (this.ptr + 1) % this.lenSteps;
        stamper.updateVoltageSource(this.nodes[4], this.nodes[0], this.voltSource1, -this.voltageR[nextPtr]);
        stamper.updateVoltageSource(this.nodes[5], this.nodes[1], this.voltSource2, -this.voltageL[nextPtr]);
        if (Math.abs(this.volts[0]) > 1e-5 || Math.abs(this.volts[1]) > 1e-5) {
            this.stopMessage = 'Need to ground transmission line!';
        }
    }

    stepFinished(_stamper: Stamper): void {
        if (this.lenSteps > 0) this.ptr = (this.ptr + 1) % this.lenSteps;
    }

    hasGroundConnection(_n1: number) { return false; }
    getConnection(_n1: number, _n2: number) { return false; }
    // The two sides share a matrix partition even though they don't conduct.
    getMatrixConnection(n1: number, n2: number) { return (n1 % 2) === (n2 % 2); }
}
