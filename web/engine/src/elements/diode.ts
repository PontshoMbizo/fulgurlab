import { CircuitElm, Stamper } from './base';
import { CircuitNode } from '../core/node';

// Ported from Diode.java + DiodeModel's default. `Diode` is the embeddable
// model (also reused by LEDElm via DiodeElm); `DiodeElm` is the standalone
// two-terminal element.
export class DiodeModel {
    saturationCurrent: number;
    seriesResistance: number;
    emissionCoefficient: number;
    breakdownVoltage: number;
    vt = 0.025865;
    vscale: number;
    vdcoef: number;

    constructor(sc: number, sr: number, ec: number, bv: number) {
        this.saturationCurrent = sc;
        this.seriesResistance = sr;
        this.emissionCoefficient = ec;
        this.breakdownVoltage = bv;
        this.vscale = ec * this.vt;
        this.vdcoef = 1 / this.vscale;
    }
}

export const DEFAULT_DIODE_MODEL = new DiodeModel(1.7143528192808883e-7, 0, 2, 0);

export class Diode {
    nodes: CircuitNode[] = [];
    leakage = 0;
    zvoltage = 0;
    vscale = 0;
    vdcoef = 0;
    vcrit = 0;
    vzcrit = 0;
    zoffset = 0;
    vt = 0.025865;
    vzcoef = 1 / 0.025865;
    lastvoltdiff = 0;

    setup(model: DiodeModel) {
        this.leakage = model.saturationCurrent;
        this.zvoltage = model.breakdownVoltage;
        this.vscale = model.vscale;
        this.vdcoef = model.vdcoef;
        this.vcrit = this.vscale * Math.log(this.vscale / (Math.SQRT2 * this.leakage));
        this.vzcrit = this.vt * Math.log(this.vt / (Math.SQRT2 * this.leakage));
        if (this.zvoltage === 0) {
            this.zoffset = 0;
        } else {
            const i = -0.005;
            this.zoffset = this.zvoltage - Math.log(-(1 + i / this.leakage)) / this.vzcoef;
        }
    }

    reset() {
        this.lastvoltdiff = 0;
    }

    limitStep(vnew: number, vold: number, stamper: Stamper): number {
        let arg: number;
        if (vnew > this.vcrit && Math.abs(vnew - vold) > (this.vscale + this.vscale)) {
            if (vold > 0) {
                arg = 1 + (vnew - vold) / this.vscale;
                if (arg > 0) {
                    vnew = vold + this.vscale * Math.log(arg);
                } else {
                    vnew = this.vcrit;
                }
            } else {
                vnew = this.vscale * Math.log(vnew / this.vscale);
            }
            stamper.converged = false;
        } else if (vnew < 0 && this.zoffset !== 0) {
            vnew = -vnew - this.zoffset;
            vold = -vold - this.zoffset;
            if (vnew > this.vzcrit && Math.abs(vnew - vold) > (this.vt + this.vt)) {
                if (vold > 0) {
                    arg = 1 + (vnew - vold) / this.vt;
                    if (arg > 0) {
                        vnew = vold + this.vt * Math.log(arg);
                    } else {
                        vnew = this.vzcrit;
                    }
                } else {
                    vnew = this.vt * Math.log(vnew / this.vt);
                }
                stamper.converged = false;
            }
            vnew = -(vnew + this.zoffset);
        }
        return vnew;
    }

    stamp(stamper: Stamper, n0: CircuitNode, n1: CircuitNode) {
        this.nodes[0] = n0;
        this.nodes[1] = n1;
        stamper.stampNonLinear(n0);
        stamper.stampNonLinear(n1);
    }

    doStep(stamper: Stamper, voltdiff: number) {
        if (Math.abs(voltdiff - this.lastvoltdiff) > 0.01) {
            stamper.converged = false;
        }
        voltdiff = this.limitStep(voltdiff, this.lastvoltdiff, stamper);
        this.lastvoltdiff = voltdiff;

        let gmin = this.leakage * 0.01;
        if (stamper.subIterations > 100) {
            gmin = Math.exp(-9 * Math.LN10 * (1 - stamper.subIterations / 3000));
            if (gmin > 0.1) gmin = 0.1;
        }

        if (voltdiff >= 0 || this.zvoltage === 0) {
            const evalue = Math.exp(voltdiff * this.vdcoef);
            const geq = this.vdcoef * this.leakage * evalue + gmin;
            const nc = (evalue - 1) * this.leakage - geq * voltdiff;
            stamper.stampConductance(this.nodes[0], this.nodes[1], geq);
            stamper.stampCurrentSource(this.nodes[0], this.nodes[1], nc);
        } else {
            const geq = this.leakage * (
                this.vdcoef * Math.exp(voltdiff * this.vdcoef) +
                this.vzcoef * Math.exp((-voltdiff - this.zoffset) * this.vzcoef)
            ) + gmin;
            const nc = this.leakage * (
                Math.exp(voltdiff * this.vdcoef) -
                Math.exp((-voltdiff - this.zoffset) * this.vzcoef) - 1
            ) + geq * (-voltdiff);
            stamper.stampConductance(this.nodes[0], this.nodes[1], geq);
            stamper.stampCurrentSource(this.nodes[0], this.nodes[1], nc);
        }
    }

    calculateCurrent(voltdiff: number): number {
        if (voltdiff >= 0 || this.zvoltage === 0) {
            return this.leakage * (Math.exp(voltdiff * this.vdcoef) - 1);
        }
        return this.leakage * (
            Math.exp(voltdiff * this.vdcoef) -
            Math.exp((-voltdiff - this.zoffset) * this.vzcoef) - 1
        );
    }
}

export class DiodeElm extends CircuitElm {
    diode: Diode;
    modelName = "default";
    model = DEFAULT_DIODE_MODEL;
    hasResistance = false;
    diodeEndNode = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.diode = new Diode();
        if (Array.isArray(params) && params.length > 0) {
            if ((flags & 2) !== 0) { // FLAG_MODEL
                this.modelName = params[0];
            }
            // FLAG_FWDROP (1): custom forward-voltage model not ported yet — falls
            // back to the default model, matching MosfetElm's documented gaps.
        }
        this.setup();
    }

    setup() {
        this.diode.setup(this.model);
        this.hasResistance = this.model.seriesResistance > 0;
        this.diodeEndNode = this.hasResistance ? 2 : 1;
    }

    nonLinear() { return true; }
    getInternalNodeCount() { return this.hasResistance ? 1 : 0; }
    getDumpType() { return 'd'; }

    reset() {
        super.reset();
        this.diode.reset();
        this.volts[0] = this.volts[1] = 0;
        if (this.hasResistance) this.volts[2] = 0;
    }

    stamp(stamper: Stamper) {
        if (this.hasResistance) {
            this.diode.stamp(stamper, this.nodes[0], this.nodes[2]);
            stamper.stampResistor(this.nodes[1], this.nodes[2], this.model.seriesResistance);
        } else {
            this.diode.stamp(stamper, this.nodes[0], this.nodes[1]);
        }
    }

    doStep(stamper: Stamper) {
        this.diode.doStep(stamper, this.volts[0] - this.volts[this.diodeEndNode]);
    }

    calculateCurrent() {
        this.current = this.diode.calculateCurrent(this.volts[0] - this.volts[this.diodeEndNode]);
    }
}
