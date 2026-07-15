import { CircuitElm, Stamper, Point, interpPoint2, interpPoint } from './base';

// Ported from MosfetElm.java (Shichman-Hodges square-law model, levels 0/1/2 =
// cutoff/triode/saturation). Node order: 0=gate, 1=drain-or-source, 2=other.
//
// SIMPLIFICATION (documented, not silently dropped): the optional body-diode
// terminal (FLAG_BODY_TERMINAL/FLAG_BODY_DIODE, hasBodyTerminal()==4 posts) is
// not stamped here — only the 3-terminal gate/drain/source model. This mirrors
// the same scoping call as skipping CurrentElm's/Switch2Elm's FindPathInfo
// dependency: revisit when the Analyzer grows body-diode / path-finding support.
export class MosfetElm extends CircuitElm {
    static FLAG_PNP = 1;
    static FLAG_SHOWVT = 2;
    static FLAG_DIGITAL = 4;
    static FLAG_FLIP = 8;
    static FLAG_HIDE_BULK = 16;
    static FLAG_BODY_DIODE = 32;
    static FLAG_BODY_TERMINAL = 64;
    static FLAG_SHOW_BODY_DIODE = 128;
    static FLAGS_GLOBAL = (MosfetElm.FLAG_HIDE_BULK | MosfetElm.FLAG_DIGITAL | MosfetElm.FLAG_SHOW_BODY_DIODE);

    pnp: number;
    bodyTerminal = 0;
    vt: number;
    beta: number;
    lastv0 = 0;
    lastv1 = 0;
    lastv2 = 0;
    ids = 0;
    mode = 0;
    gm = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.pnp = ((flags & MosfetElm.FLAG_PNP) !== 0) ? -1 : 1;
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 0) {
            this.vt = parseFloat(params[0]) || 1.5;
            this.beta = params.length > 1 ? parseFloat(params[1]) : 0.02;
        } else {
            this.vt = 1.5;
            this.beta = 0.02;
        }
    }

    nonLinear() { return true; }
    getDumpType() { return 'f'; }
    // `pnp` is NOT a dump token -- it's derived purely from flags&FLAG_PNP,
    // already preserved via the base 5-token prefix.
    dumpTokens() { return [this.vt, this.beta]; }
    getPostCount() { return this.hasBodyTerminal() ? 4 : 3; }
    hasBodyTerminal() { return (this.flags & MosfetElm.FLAG_BODY_TERMINAL) !== 0 && this.doBodyDiode(); }
    doBodyDiode() { return (this.flags & MosfetElm.FLAG_BODY_DIODE) !== 0 && this.showBulk(); }
    showBulk() { return (this.flags & (MosfetElm.FLAG_DIGITAL | MosfetElm.FLAG_HIDE_BULK)) === 0; }

    src: Point = { x: 0, y: 0 };
    drn: Point = { x: 0, y: 0 };
    body: Point = { x: 0, y: 0 };

    // Ported from MosfetElm.java setPoints(): gate stays at point1; source and
    // drain straddle the far end (fraction 1) by `hs` (16px), sign chosen by
    // dsign/FLAG_FLIP; body (when shown) is the source/drain midpoint.
    setPoints() {
        super.setPoints();
        let hs2 = 16 * this.dsign;
        if ((this.flags & MosfetElm.FLAG_FLIP) !== 0) hs2 = -hs2;
        [this.src, this.drn] = interpPoint2(this.point1, this.point2, 1, -hs2);
        if (this.showBulk()) {
            this.body = interpPoint(this.src, this.drn, 0.5);
        }
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.src;
        if (n === 2) return this.drn;
        return this.body;
    }

    reset() {
        super.reset();
        this.lastv0 = this.lastv1 = this.lastv2 = 0;
        this.volts[0] = this.volts[1] = this.volts[2] = 0;
    }

    nonConvergence(last: number, now: number, subIterations: number): boolean {
        let diff = Math.abs(last - now);
        if (this.beta > 1) diff *= 100;
        if (diff < 0.01) return false;
        if (subIterations > 10 && diff < Math.abs(now) * 0.001) return false;
        if (subIterations > 100 && diff < 0.01 + (subIterations - 100) * 0.0001) return false;
        return true;
    }

    stamp(stamper: Stamper) {
        stamper.stampNonLinear(this.nodes[1]);
        stamper.stampNonLinear(this.nodes[2]);
        if (this.hasBodyTerminal()) {
            this.bodyTerminal = 3;
        } else {
            this.bodyTerminal = (this.pnp === -1) ? 2 : 1;
        }
    }

    doStep(stamper: Stamper) {
        this.calculate(false, stamper);
    }

    stepFinished(stamper: Stamper) {
        this.calculate(true, stamper);
    }

    private calculate(finished: boolean, stamper: Stamper) {
        const vs = [0, 0, 0];
        vs[0] = this.volts[0];
        vs[1] = this.volts[1];
        vs[2] = this.volts[2];
        if (!finished) {
            if (vs[1] > this.lastv1 + 0.5) vs[1] = this.lastv1 + 0.5;
            if (vs[1] < this.lastv1 - 0.5) vs[1] = this.lastv1 - 0.5;
            if (vs[2] > this.lastv2 + 0.5) vs[2] = this.lastv2 + 0.5;
            if (vs[2] < this.lastv2 - 0.5) vs[2] = this.lastv2 - 0.5;
        }

        let source = 1;
        let drain = 2;
        if (this.pnp * vs[1] > this.pnp * vs[2]) {
            source = 2;
            drain = 1;
        }
        const gate = 0;
        let vgs = vs[gate] - vs[source];
        let vds = vs[drain] - vs[source];

        if (!finished && (this.nonConvergence(this.lastv1, vs[1], stamper.subIterations) ||
            this.nonConvergence(this.lastv2, vs[2], stamper.subIterations) ||
            this.nonConvergence(this.lastv0, vs[0], stamper.subIterations))) {
            stamper.converged = false;
        }
        this.lastv0 = vs[0];
        this.lastv1 = vs[1];
        this.lastv2 = vs[2];

        const realvgs = vgs;
        const realvds = vds;
        vgs *= this.pnp;
        vds *= this.pnp;
        this.ids = 0;
        this.gm = 0;
        let Gds = 0;

        if (vgs < this.vt) {
            Gds = 1e-8;
            this.ids = vds * Gds;
            this.mode = 0;
        } else if (vds < vgs - this.vt) {
            this.ids = this.beta * ((vgs - this.vt) * vds - vds * vds * 0.5);
            this.gm = this.beta * vds;
            Gds = this.beta * (vgs - vds - this.vt);
            this.mode = 1;
        } else {
            this.gm = this.beta * (vgs - this.vt);
            Gds = 1e-8;
            this.ids = 0.5 * this.beta * (vgs - this.vt) * (vgs - this.vt) + (vds - (vgs - this.vt)) * Gds;
            this.mode = 2;
        }

        const ids0 = this.ids;
        if ((source === 2 && this.pnp === 1) || (source === 1 && this.pnp === -1)) {
            this.ids = -this.ids;
        }
        if (finished) return;

        const rs = -this.pnp * ids0 + Gds * realvds + this.gm * realvgs;
        stamper.stampMatrix(this.nodes[drain], this.nodes[drain], Gds);
        stamper.stampMatrix(this.nodes[drain], this.nodes[source], -Gds - this.gm);
        stamper.stampMatrix(this.nodes[drain], this.nodes[gate], this.gm);
        stamper.stampMatrix(this.nodes[source], this.nodes[drain], -Gds);
        stamper.stampMatrix(this.nodes[source], this.nodes[source], Gds + this.gm);
        stamper.stampMatrix(this.nodes[source], this.nodes[gate], -this.gm);
        stamper.stampRightSide(this.nodes[drain], rs);
        stamper.stampRightSide(this.nodes[source], -rs);
    }
}
