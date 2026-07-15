import { CircuitElm, Stamper, Point, interpPoint2 } from './base';

// Ported from TransistorModel.java + TransistorElm.java (Ebers-Moll with Early
// voltage modulation and BE/BC junction capacitance). Node order: 0=base,
// 1=collector, 2=emitter (matches Java).
export class TransistorModel {
    name: string;
    description: string;
    satCur: number;
    invRollOffF = 0;
    BEleakCur = 0;
    leakBEemissionCoeff = 1.5;
    invRollOffR = 0;
    BCleakCur = 0;
    leakBCemissionCoeff = 2;
    emissionCoeffF = 1;
    emissionCoeffR = 1;
    invEarlyVoltF = 0;
    invEarlyVoltR = 0;
    betaR = 1;
    junctionCapBE = 0;
    junctionCapBC = 0;
    junctionPotBE = 0.75;
    junctionPotBC = 0.75;
    junctionExpBE = 0.33;
    junctionExpBC = 0.33;
    transitTimeF = 0;
    transitTimeR = 0;

    constructor(name: string, description: string, satCur: number) {
        this.name = name;
        this.description = description;
        this.satCur = satCur;
    }
}

// Java addDefaultModel("default", new TransistorModel("default", 1e-13)).
export const DEFAULT_TRANSISTOR_MODEL = new TransistorModel("default", "default", 1e-13);

export class TransistorElm extends CircuitElm {
    pnp: number;
    beta: number;
    model = DEFAULT_TRANSISTOR_MODEL;
    badIters = 0;
    localSubIters = 0;
    lastvbc = 0;
    lastvbe = 0;
    vcrit = 0;
    vt = 0.025865;
    ic = 0;
    ie = 0;
    ib = 0;
    capVoltBE = 0;
    capVoltBC = 0;
    capCurBE = 0;
    capCurBC = 0;
    geqBE = 0;
    geqBC = 0;
    ceqBE = 0;
    ceqBC = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // NOTE: `pnp` is its own dump token (+-1), not derived from a flags
        // bit — an earlier draft of this port read it as `(flags&1)!==0`,
        // which is wrong (bit 1 in TransistorElm.java is FLAG_FLIP, an
        // unrelated draw-only "swap E/C" flag). Verified against the real
        // TransistorElm.java ctor before fixing: token order is
        // `pnp, lastvbe, lastvbc, beta, modelName`.
        if (Array.isArray(params) && params.length > 0) {
            this.pnp = parseInt(params[0]) || 1;
            this.beta = 100;
            if (params.length > 3) {
                this.lastvbe = parseFloat(params[1]) || 0;
                this.lastvbc = parseFloat(params[2]) || 0;
                this.beta = parseFloat(params[3]) || 100;
            }
        } else {
            this.pnp = typeof params === 'number' ? params : 1;
            this.beta = 100;
        }
        this.setup();
    }

    setup() {
        this.vcrit = this.vt * Math.log(this.vt / (Math.SQRT2 * this.model.satCur));
    }

    nonLinear() { return true; }
    getInternalNodeCount() { return 0; }
    getDumpType() { return 't'; }
    // Must always emit all 4 tokens together: the constructor only reads
    // lastvbe/lastvbc/beta when `params.length > 3` -- emitting fewer (e.g.
    // just [pnp, beta]) would silently reset beta to its 100 default on
    // every reparse.
    dumpTokens() { return [this.pnp, this.lastvbe, this.lastvbc, this.beta]; }
    getPostCount() { return 3; }

    static FLAG_FLIP = 1; // "swap E/C" — draw-only, but flips collector/emitter posts too
    coll: Point = { x: 0, y: 0 };
    emit: Point = { x: 0, y: 0 };

    // Ported from TransistorElm.java setPoints(): base = point1; collector and
    // emitter sit at the far end (fraction 1) straddling the line by 16px,
    // ordered by pnp and dsign (and flipped again by FLAG_FLIP).
    setPoints() {
        super.setPoints();
        if ((this.flags & TransistorElm.FLAG_FLIP) !== 0) this.dsign = -this.dsign;
        const hs2 = 16 * this.dsign * this.pnp;
        [this.coll, this.emit] = interpPoint2(this.point1, this.point2, 1, hs2);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.coll;
        return this.emit;
    }

    reset() {
        super.reset();
        this.volts[0] = this.volts[1] = this.volts[2] = 0;
        this.lastvbc = this.lastvbe = 0;
        this.capVoltBE = this.capVoltBC = this.capCurBE = this.capCurBC = 0;
        this.geqBE = this.geqBC = this.ceqBE = this.ceqBC = 0;
        this.badIters = 0;
        this.localSubIters = 0;
    }

    limitStep(vnew: number, vold: number, stamper: Stamper): number {
        let arg: number;
        if (vnew > this.vcrit && Math.abs(vnew - vold) > (this.vt + this.vt)) {
            if (vold > 0) {
                arg = 1 + (vnew - vold) / this.vt;
                vnew = arg > 0 ? vold + this.vt * Math.log(arg) : this.vcrit;
            } else {
                vnew = this.vt * Math.log(vnew / this.vt);
            }
            stamper.converged = false;
        }
        return vnew;
    }

    calcJunctionCap(vj: number, cj0: number, vj0: number, mj: number): number {
        if (cj0 <= 0) return 0;
        const fc = 0.5;
        if (vj < fc * vj0) {
            return cj0 / Math.pow(1 - vj / vj0, mj);
        }
        return cj0 / Math.pow(1 - fc, 1 + mj) * (1 - fc * (1 + mj) + mj * vj / vj0);
    }

    startIteration(stamper: Stamper) {
        const hasBEcap = this.model.junctionCapBE > 0 || this.model.transitTimeF > 0;
        const hasBCcap = this.model.junctionCapBC > 0 || this.model.transitTimeR > 0;
        if (hasBEcap && stamper.timeStep > 0) {
            const vjBE = this.pnp * this.capVoltBE;
            let cje = this.calcJunctionCap(vjBE, this.model.junctionCapBE, this.model.junctionPotBE, this.model.junctionExpBE);
            if (this.model.transitTimeF > 0 && vjBE > 0) {
                const vtn = this.vt * this.model.emissionCoeffF;
                cje += this.model.transitTimeF * this.model.satCur * Math.exp(vjBE / vtn) / vtn;
            }
            this.geqBE = 2 * cje / stamper.timeStep;
            if (this.geqBE < 1e-20) {
                this.geqBE = this.ceqBE = this.capCurBE = 0;
            } else {
                this.ceqBE = -this.geqBE * this.capVoltBE - this.capCurBE;
            }
        }
        if (hasBCcap && stamper.timeStep > 0) {
            const vjBC = this.pnp * this.capVoltBC;
            let cjc = this.calcJunctionCap(vjBC, this.model.junctionCapBC, this.model.junctionPotBC, this.model.junctionExpBC);
            if (this.model.transitTimeR > 0 && vjBC > 0) {
                const vtn = this.vt * this.model.emissionCoeffR;
                cjc += this.model.transitTimeR * this.model.satCur * Math.exp(vjBC / vtn) / vtn;
            }
            this.geqBC = 2 * cjc / stamper.timeStep;
            if (this.geqBC < 1e-20) {
                this.geqBC = this.ceqBC = this.capCurBC = 0;
            } else {
                this.ceqBC = -this.geqBC * this.capVoltBC - this.capCurBC;
            }
        }
    }

    stamp(stamper: Stamper) {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
        stamper.stampNonLinear(this.nodes[2]);
    }

    doStep(stamper: Stamper) {
        let vbc = this.pnp * (this.volts[0] - this.volts[1]);
        let vbe = this.pnp * (this.volts[0] - this.volts[2]);
        const notConverged = Math.abs(vbc - this.lastvbc) > 0.01 || Math.abs(vbe - this.lastvbe) > 0.01;
        if (notConverged) stamper.converged = false;
        if (notConverged) this.localSubIters++; else this.localSubIters = 0;

        let gmin = 1e-12;
        if (this.localSubIters > 100 && this.badIters < 5) {
            gmin = Math.exp(-9 * Math.LN10 * (1 - this.localSubIters / 300));
            if (gmin > 0.1) gmin = 0.1;
        }

        vbc = this.limitStep(vbc, this.lastvbc, stamper);
        vbe = this.limitStep(vbe, this.lastvbe, stamper);
        this.lastvbc = vbc;
        this.lastvbe = vbe;

        const csat = this.model.satCur;
        const oik = this.model.invRollOffF;
        const c2 = this.model.BEleakCur;
        const vte = this.model.leakBEemissionCoeff * this.vt;
        const oikr = this.model.invRollOffR;
        const c4 = this.model.BCleakCur;
        const vtc = this.model.leakBCemissionCoeff * this.vt;

        let vtn = this.vt * this.model.emissionCoeffF;
        let evbe: number, cbe: number, gbe: number, cben: number, gben: number, evben: number;
        let evbc: number, cbc: number, gbc: number, cbcn: number, gbcn: number, evbcn: number;
        let qb: number, dqbdve: number, dqbdvc: number, q2: number, sqarg: number, arg: number;

        if (vbe > -5 * vtn) {
            evbe = Math.exp(vbe / vtn);
            cbe = csat * (evbe - 1) + gmin * vbe;
            gbe = csat * evbe / vtn + gmin;
            if (c2 === 0) {
                cben = 0;
                gben = 0;
            } else {
                evben = Math.exp(vbe / vte);
                cben = c2 * (evben - 1);
                gben = c2 * evben / vte;
            }
        } else {
            gbe = -csat / vbe + gmin;
            cbe = gbe * vbe;
            gben = -c2 / vbe;
            cben = gben * vbe;
        }

        vtn = this.vt * this.model.emissionCoeffR;
        if (vbc > -5 * vtn) {
            evbc = Math.exp(vbc / vtn);
            cbc = csat * (evbc - 1) + gmin * vbc;
            gbc = csat * evbc / vtn + gmin;
            if (c4 === 0) {
                cbcn = 0;
                gbcn = 0;
            } else {
                evbcn = Math.exp(vbc / vtc);
                cbcn = c4 * (evbcn - 1);
                gbcn = c4 * evbcn / vtc;
            }
        } else {
            gbc = -csat / vbc + gmin;
            cbc = gbc * vbc;
            gbcn = -c4 / vbc;
            cbcn = gbcn * vbc;
        }

        const q1 = 1 / (1 - this.model.invEarlyVoltF * vbc - this.model.invEarlyVoltR * vbe);
        if (oik === 0 && oikr === 0) {
            qb = q1;
            dqbdve = q1 * qb * this.model.invEarlyVoltR;
            dqbdvc = q1 * qb * this.model.invEarlyVoltF;
        } else {
            q2 = oik * cbe + oikr * cbc;
            arg = Math.max(0, 1 + 4 * q2);
            sqarg = 1;
            if (arg !== 0) sqarg = Math.sqrt(arg);
            qb = q1 * (1 + sqarg) / 2;
            dqbdve = q1 * (qb * this.model.invEarlyVoltR + oik * gbe / sqarg);
            dqbdvc = q1 * (qb * this.model.invEarlyVoltF + oikr * gbc / sqarg);
        }

        const cex = cbe;
        const gex = gbe;
        const cc = (cex - cbc) / qb - cbc / this.model.betaR - cbcn;
        const cb = cbe / this.beta + cben + cbc / this.model.betaR + cbcn;
        this.ic = this.pnp * cc;
        this.ib = this.pnp * cb;
        this.ie = this.pnp * (-cc - cb);

        const gpi = gbe / this.beta + gben;
        const gmu = gbc / this.model.betaR + gbcn;
        const go = (gbc + (cex - cbc) * dqbdvc / qb) / qb;
        const gm = (gex - (cex - cbc) * dqbdve / qb) / qb - go;

        const ceqbe = this.pnp * (cc + cb - vbe * (gm + go + gpi) + vbc * go);
        const ceqbc = this.pnp * (-cc + vbe * (gm + go) - vbc * (gmu + go));

        // Node 0 = base, 1 = collector, 2 = emitter.
        stamper.stampMatrix(this.nodes[1], this.nodes[1], gmu + go);
        stamper.stampMatrix(this.nodes[1], this.nodes[0], -gmu + gm);
        stamper.stampMatrix(this.nodes[1], this.nodes[2], -gm - go);
        stamper.stampMatrix(this.nodes[0], this.nodes[0], gpi + gmu);
        stamper.stampMatrix(this.nodes[0], this.nodes[2], -gpi);
        stamper.stampMatrix(this.nodes[0], this.nodes[1], -gmu);
        stamper.stampMatrix(this.nodes[2], this.nodes[0], -gpi - gm);
        stamper.stampMatrix(this.nodes[2], this.nodes[1], -go);
        stamper.stampMatrix(this.nodes[2], this.nodes[2], gpi + gm + go);
        stamper.stampRightSide(this.nodes[0], -ceqbe - ceqbc);
        stamper.stampRightSide(this.nodes[1], ceqbc);
        stamper.stampRightSide(this.nodes[2], ceqbe);

        if (this.geqBE > 0) {
            stamper.stampMatrix(this.nodes[0], this.nodes[0], this.geqBE);
            stamper.stampMatrix(this.nodes[2], this.nodes[2], this.geqBE);
            stamper.stampMatrix(this.nodes[0], this.nodes[2], -this.geqBE);
            stamper.stampMatrix(this.nodes[2], this.nodes[0], -this.geqBE);
            stamper.stampRightSide(this.nodes[0], -this.ceqBE);
            stamper.stampRightSide(this.nodes[2], this.ceqBE);
        }
        if (this.geqBC > 0) {
            stamper.stampMatrix(this.nodes[0], this.nodes[0], this.geqBC);
            stamper.stampMatrix(this.nodes[1], this.nodes[1], this.geqBC);
            stamper.stampMatrix(this.nodes[0], this.nodes[1], -this.geqBC);
            stamper.stampMatrix(this.nodes[1], this.nodes[0], -this.geqBC);
            stamper.stampRightSide(this.nodes[0], -this.ceqBC);
            stamper.stampRightSide(this.nodes[1], this.ceqBC);
        }
    }
}
