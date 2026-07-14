import { CircuitElm, Stamper, Point, interpPoint2 } from './base';

// Ported from OpAmpElm.java. Ideal op-amp modelled as a voltage-controlled
// voltage source with a soft (tanh-free, piecewise-linear) saturation clamp —
// same damped-Newton approach as the Java source (`lastvd` symmetry breaking).
export class OpAmpElm extends CircuitElm {
    maxOut = 15;
    minOut = -15;
    gain = 100000;
    gbw = 1e6;
    static FLAG_SWAP = 1;
    static FLAG_SMALL = 2;
    static FLAG_LOWGAIN = 4;
    static FLAG_GAIN = 8;
    lastvd = 0;
    opsize = 2;
    opheight = 0;
    opwidth = 0;
    in1p: Point = { x: 0, y: 0 };
    in2p: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        this.setGain();
        this.setSize((flags & OpAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
    }

    setGain() {
        if ((this.flags & OpAmpElm.FLAG_GAIN) !== 0) return;
        this.gain = ((this.flags & OpAmpElm.FLAG_LOWGAIN) !== 0) ? 1000 : 100000;
    }

    setSize(s: number) {
        this.opsize = s;
        this.opheight = 8 * s;
        this.opwidth = 13 * s;
        this.flags = (this.flags & ~OpAmpElm.FLAG_SMALL) | ((s === 1) ? OpAmpElm.FLAG_SMALL : 0);
    }

    // Ported from OpAmpElm.java setPoints(): the two inputs sit at fraction 0
    // (i.e. at point1's position along the line) split apart perpendicular by
    // +/-opheight; the output is point2 itself.
    setPoints() {
        super.setPoints();
        let ww = this.opwidth;
        if (ww > this.dn / 2) ww = this.dn / 2;
        this.calcLeads(ww * 2);
        let hs = this.opheight * this.dsign;
        if ((this.flags & OpAmpElm.FLAG_SWAP) !== 0) hs = -hs;
        [this.in1p, this.in2p] = interpPoint2(this.point1, this.point2, 0, hs);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.in1p;
        if (n === 1) return this.in2p;
        return this.point2;
    }

    nonLinear() { return true; }
    getDumpType() { return 'a'; }
    getPostCount() { return 3; }
    getVoltageSourceCount() { return 1; }

    stamp(stamper: Stamper) {
        const vs = this.voltSource;
        stamper.stampNonLinear(this.nodes[2]);
        // Node 2's (output) KCL row gets the +1 coefficient on the voltage
        // source's current unknown: row=node, col=vs (Java: stampMatrix(nodes[2],
        // voltSource, 1)). This is the opposite argument order from the four
        // stampMatrixVSNode calls in doStep(), which stamp into the voltage
        // source's OWN row (the linearized op-amp equation) instead.
        stamper.stampMatrixNodeVS(this.nodes[2], vs, 1);
    }

    doStep(stamper: Stamper) {
        const vd = this.volts[1] - this.volts[0];
        const midpoint = (this.maxOut + this.minOut) * 0.5;
        if (Math.abs(this.lastvd - vd) > 0.1) {
            stamper.converged = false;
        } else if (this.volts[2] > this.maxOut + 0.1 || this.volts[2] < this.minOut - 0.1) {
            stamper.converged = false;
        }
        let x = 0;
        let dx = 0;
        const maxAdj = this.maxOut - midpoint;
        const minAdj = this.minOut - midpoint;
        // Java breaks symmetry at the rails with app.getrand(4)==1 (25% chance);
        // Math.random() < 0.25 is the equivalent one-in-four draw.
        if (vd >= maxAdj / this.gain && (this.lastvd >= 0 || Math.random() < 0.25)) {
            dx = 1e-4;
            x = this.maxOut - dx * maxAdj / this.gain;
        } else if (vd <= minAdj / this.gain && (this.lastvd <= 0 || Math.random() < 0.25)) {
            dx = 1e-4;
            x = this.minOut - dx * minAdj / this.gain;
        } else {
            dx = this.gain;
            x = midpoint;
        }
        const vs = this.voltSource;
        stamper.stampMatrixVSNode(vs, this.nodes[0], dx);
        stamper.stampMatrixVSNode(vs, this.nodes[1], -dx);
        stamper.stampMatrixVSNode(vs, this.nodes[2], 1);
        stamper.stampRightSideVS(vs, x);
        this.lastvd = vd;
    }

    validateRailNode(n: number) { return true; }
    validate() { return true; }
}
